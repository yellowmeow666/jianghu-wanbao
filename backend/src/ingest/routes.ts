import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendError, type ErrorCode } from '../errors.js';
import { ValidationError } from '../cards/validate.js';
import type { CardStore } from '../cards/types.js';
import { classifySourceType, score818, truncateSummary } from './score.js';
import { createHttpFetcher, fetchTiebaPage, IngestFetchError, type PageFetcher } from './tieba/fetch.js';
import { parsePostedAt, parseTiebaListHtml, parseTiebaPostHtml } from './tieba/parser.js';
import { normalizeTiebaPostUrl, tiebaListUrl } from './tieba/url.js';
import {
  createRateLimiter,
  parseIngestRateLimit,
  tokenFingerprint,
  type RateLimiter,
} from './rateLimit.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function actorFromToken(token: string): string {
  return token ? tokenFingerprint(token) : 'admin';
}

export interface IngestRouterOptions {
  store: CardStore;
  adminToken: string;
  now?: () => Date;
  fetchPage?: PageFetcher;
  rateLimitPerMinute?: number;
  rateLimiter?: RateLimiter;
}

export function createIngestRouter(opts: IngestRouterOptions): Router {
  const { store, adminToken } = opts;
  const now = opts.now ?? (() => new Date());
  const fetchPage = opts.fetchPage ?? createHttpFetcher();
  const limit =
    opts.rateLimitPerMinute ??
    parseIngestRateLimit(process.env.INGEST_RATE_LIMIT, 10);
  const limiter = opts.rateLimiter ?? createRateLimiter(limit);
  const router = Router();

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('X-Admin-Token');
    if (!adminToken || token !== adminToken) {
      sendError(res, 'UNAUTHORIZED');
      return;
    }
    next();
  };

  const enforceRate = (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('X-Admin-Token') ?? '';
    const key = actorFromToken(token);
    if (!limiter.tryTake(key, now())) {
      sendError(res, 'RATE_LIMITED');
      return;
    }
    next();
  };

  async function ingestByUrl(req: Request, res: Response, next: NextFunction, action: string) {
    try {
      if (!isPlainObject(req.body)) {
        sendError(res, 'INVALID_BODY', 'body must be a JSON object');
        return;
      }
      let url: string;
      try {
        url = normalizeTiebaPostUrl(req.body.url);
      } catch (err) {
        if (err instanceof ValidationError) {
          sendError(res, 'INVALID_BODY', err.message);
          return;
        }
        throw err;
      }

      const existing = await store.getBySourceUrl(url);
      if (existing) {
        await store.appendIngestLog(
          {
            actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
            action,
            target: url,
            meta: { result: 'ALREADY_EXISTS', card_id: existing.id },
          },
          now(),
        );
        sendError(res, 'ALREADY_EXISTS', 'card already exists for source_url', {
          card_id: existing.id,
        });
        return;
      }

      // Fetch + parse BEFORE any card write (no partial success)
      const page = await fetchTiebaPage(fetchPage, url);
      const parsed = parseTiebaPostHtml(page.body, url);
      const summary = truncateSummary(parsed.body, 200);
      const source_type = classifySourceType(`${parsed.title}\n${parsed.body}`);

      let card;
      try {
        card = await store.create(
          {
            title: parsed.title.slice(0, 200),
            summary,
            timeline: [{ at: parsed.posted_at, text: summary.slice(0, 500) }],
            source_platform: 'tieba',
            source_type,
            clarified: false,
            source_url: url,
          },
          now(),
        );
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === 'ER_DUP_ENTRY') {
          const again = await store.getBySourceUrl(url);
          sendError(
            res,
            'ALREADY_EXISTS',
            'card already exists for source_url',
            again ? { card_id: again.id } : undefined,
          );
          return;
        }
        throw err;
      }

      await store.appendIngestLog(
        {
          actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
          action,
          target: url,
          meta: { result: 'ok', card_id: card.id, author: parsed.author },
        },
        now(),
      );

      res.status(201).json(card);
    } catch (err) {
      if (err instanceof IngestFetchError) {
        sendError(res, err.code as ErrorCode, err.message);
        try {
          const rawUrl =
            isPlainObject(req.body) && typeof req.body.url === 'string' ? req.body.url : '';
          await store.appendIngestLog(
            {
              actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
              action,
              target: rawUrl.slice(0, 512),
              meta: { result: err.code, message: err.message },
            },
            now(),
          );
        } catch {
          /* ignore log failure */
        }
        return;
      }
      next(err);
    }
  }

  router.post(
    '/api/admin/ingest/tieba/by-url',
    requireAdmin,
    enforceRate,
    (req, res, next) => {
      void ingestByUrl(req, res, next, 'by-url');
    },
  );

  router.post(
    '/api/admin/ingest/tieba/import',
    requireAdmin,
    enforceRate,
    (req, res, next) => {
      void ingestByUrl(req, res, next, 'import');
    },
  );

  router.post(
    '/api/admin/ingest/tieba/scan',
    requireAdmin,
    enforceRate,
    async (req, res, next) => {
      try {
        if (!isPlainObject(req.body)) {
          sendError(res, 'INVALID_BODY', 'body must be a JSON object');
          return;
        }
        const bar =
          req.body.bar === undefined || req.body.bar === null || req.body.bar === ''
            ? '剑网3'
            : typeof req.body.bar === 'string'
              ? req.body.bar.trim()
              : null;
        if (bar === null || !bar) {
          sendError(res, 'INVALID_BODY', 'bar must be a string');
          return;
        }
        if (typeof req.body.since !== 'string' || !req.body.since.trim()) {
          sendError(res, 'INVALID_BODY', 'since must be a non-empty string');
          return;
        }
        if (typeof req.body.until !== 'string' || !req.body.until.trim()) {
          sendError(res, 'INVALID_BODY', 'until must be a non-empty string');
          return;
        }
        const since = parsePostedAt(req.body.since);
        const until = parsePostedAt(req.body.until);
        if (!since || !until) {
          sendError(res, 'INVALID_BODY', 'since/until must be parseable datetimes');
          return;
        }
        let limitN = 50;
        if (req.body.limit !== undefined) {
          const n = Number(req.body.limit);
          if (!Number.isInteger(n) || n < 1 || n > 200) {
            sendError(res, 'INVALID_BODY', 'limit must be an integer 1..200');
            return;
          }
          limitN = n;
        }

        const listUrl = tiebaListUrl(bar);
        const page = await fetchTiebaPage(fetchPage, listUrl);
        const items = parseTiebaListHtml(page.body);

        const candidates: Array<{
          title: string;
          posted_at: string;
          url: string;
          score: number;
          reasons: string[];
        }> = [];

        for (const item of items) {
          const at = parsePostedAt(item.posted_at);
          if (at) {
            if (at.getTime() < since.getTime() || at.getTime() > until.getTime()) continue;
          }
          // If posted_at unknown, still include (caller can filter)
          const { score, reasons } = score818(item.title);
          if (score <= 0) continue;
          candidates.push({
            title: item.title,
            posted_at: item.posted_at,
            url: item.url,
            score,
            reasons,
          });
          if (candidates.length >= limitN) break;
        }

        candidates.sort((a, b) => b.score - a.score || b.posted_at.localeCompare(a.posted_at));

        await store.appendIngestLog(
          {
            actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
            action: 'scan',
            target: bar.slice(0, 512),
            meta: {
              result: 'ok',
              since: req.body.since,
              until: req.body.until,
              candidate_count: candidates.length,
            },
          },
          now(),
        );

        res.json({ candidates });
      } catch (err) {
        if (err instanceof IngestFetchError) {
          sendError(res, err.code as ErrorCode, err.message);
          try {
            const bar =
              isPlainObject(req.body) && typeof req.body.bar === 'string' ? req.body.bar : '剑网3';
            await store.appendIngestLog(
              {
                actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
                action: 'scan',
                target: String(bar).slice(0, 512),
                meta: { result: err.code, message: err.message },
              },
              now(),
            );
          } catch {
            /* ignore */
          }
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
