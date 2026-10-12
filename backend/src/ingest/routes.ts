import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendError, type ErrorCode } from '../errors.js';
import { ValidationError } from '../cards/validate.js';
import type { CardStore } from '../cards/types.js';
import { classifySourceType, score818, truncateSummary } from './score.js';
import { createHttpFetcher, fetchTiebaPage, IngestFetchError, type FetchInit, type PageFetcher } from './tieba/fetch.js';
import { parsePostedAt, parseTiebaListHtml, parseTiebaPostHtml } from './tieba/parser.js';
import { normalizeTiebaPostUrl, tiebaListUrl } from './tieba/url.js';
import { CookieParseError, parseCookieContent } from './tieba/cookieParse.js';
import {
  CookieKeyError,
  createTiebaCookieStore,
  resolveTiebaCookieStorePath,
  type TiebaCookieStore,
} from './tieba/cookieStore.js';
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
  cookieStorePath?: string;
  cookieEncryptionKey?: string | null;
  /** 测试可注入；缺省为加密文件存储。 */
  cookieStore?: TiebaCookieStore;
}

export function createIngestRouter(opts: IngestRouterOptions): Router {
  const { store, adminToken } = opts;
  const now = opts.now ?? (() => new Date());
  const fetchPage = opts.fetchPage ?? createHttpFetcher();
  const limit =
    opts.rateLimitPerMinute ??
    parseIngestRateLimit(process.env.INGEST_RATE_LIMIT, 10);
  const limiter = opts.rateLimiter ?? createRateLimiter(limit);
  const cookies =
    opts.cookieStore ??
    createTiebaCookieStore({
      filePath: opts.cookieStorePath ?? resolveTiebaCookieStorePath(),
      encryptionKey: opts.cookieEncryptionKey,
    });
  const router = Router();

  /** 仅 valid 的 Cookie 会附到贴吧请求上；missing / expired 与未配置密钥时不带头。 */
  async function cookieForFetch(): Promise<{ used: boolean; init?: FetchInit }> {
    const header = await cookies.headerForRequest();
    if (!header) return { used: false };
    return { used: true, init: { headers: { Cookie: header } } };
  }

  async function noteCaptcha(usedCookie: boolean): Promise<boolean> {
    if (!usedCookie) return false;
    try {
      // 带着 Cookie 仍然撞上验证码墙：标 expired，下次不再附带，直到管理员重新粘贴。
      await cookies.markExpired();
      return true;
    } catch {
      // 标记失败不能改变本次 403；Cookie 仍保持 valid，下次请求还会再试。
      console.error('[tieba-cookie] failed to mark cookie expired after captcha');
      return false;
    }
  }

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
    let usedCookie = false;
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
          sendError(res, 'INVALID_URL', err.message);
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
            meta: { result: 'ALREADY_EXISTS', card_id: existing.id, used_cookie: false },
          },
          now(),
        );
        sendError(res, 'ALREADY_EXISTS', 'card already exists for source_url', {
          card_id: existing.id,
        });
        return;
      }

      // Fetch + parse BEFORE any card write (no partial success)
      const cookieUse = await cookieForFetch();
      usedCookie = cookieUse.used;
      const page = await fetchTiebaPage(fetchPage, url, cookieUse.init);
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
          meta: { result: 'ok', card_id: card.id, author: parsed.author, used_cookie: usedCookie },
        },
        now(),
      );

      res.status(201).json(card);
    } catch (err) {
      if (err instanceof IngestFetchError) {
        const markedExpired = err.code === 'CAPTCHA' ? await noteCaptcha(usedCookie) : false;
        sendError(
          res,
          err.code as ErrorCode,
          err.message,
          // 管理端用同级 cookie_status 决定是否刷新状态条；不含 Cookie 明文。
          markedExpired ? { cookie_status: 'expired' } : undefined,
        );
        try {
          const rawUrl =
            isPlainObject(req.body) && typeof req.body.url === 'string' ? req.body.url : '';
          await store.appendIngestLog(
            {
              actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
              action,
              target: rawUrl.slice(0, 512),
              meta: { result: err.code, message: err.message, used_cookie: usedCookie },
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
      let usedCookie = false;
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
        const cookieUse = await cookieForFetch();
        usedCookie = cookieUse.used;
        const page = await fetchTiebaPage(fetchPage, listUrl, cookieUse.init);
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
              used_cookie: usedCookie,
            },
          },
          now(),
        );

        res.json({ candidates });
      } catch (err) {
        if (err instanceof IngestFetchError) {
          const markedExpired = err.code === 'CAPTCHA' ? await noteCaptcha(usedCookie) : false;
          sendError(
            res,
            err.code as ErrorCode,
            err.message,
            markedExpired ? { cookie_status: 'expired' } : undefined,
          );
          try {
            const bar =
              isPlainObject(req.body) && typeof req.body.bar === 'string' ? req.body.bar : '剑网3';
            await store.appendIngestLog(
              {
                actor: actorFromToken(req.get('X-Admin-Token') ?? ''),
                action: 'scan',
                target: String(bar).slice(0, 512),
                meta: { result: err.code, message: err.message, used_cookie: usedCookie },
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

  // Cookie 管理不占采集限流配额：只鉴权，不抓贴吧。
  router.put('/api/admin/ingest/tieba/cookie', requireAdmin, async (req, res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        sendError(res, 'INVALID_BODY', 'body must be a JSON object');
        return;
      }
      const format = req.body.format;
      const content = req.body.content;
      if (format !== 'netscape' && format !== 'json') {
        sendError(res, 'INVALID_BODY', 'format must be netscape or json');
        return;
      }
      if (typeof content !== 'string') {
        sendError(res, 'INVALID_BODY', 'content must be a string');
        return;
      }
      let header: string;
      try {
        header = parseCookieContent(format, content);
      } catch (err) {
        if (err instanceof CookieParseError) {
          sendError(res, 'INVALID_BODY', err.message);
          return;
        }
        throw err;
      }
      await cookies.save(header, now());
      // 204 且无响应体，避免把 Cookie 明文带回客户端。
      res.status(204).end();
    } catch (err) {
      if (err instanceof CookieKeyError) {
        sendError(res, 'INTERNAL', 'cookie encryption key is not configured');
        return;
      }
      next(err);
    }
  });

  router.get('/api/admin/ingest/tieba/cookie', requireAdmin, async (_req, res, next) => {
    try {
      const view = await cookies.status();
      res.json({ status: view.status, updated_at: view.updated_at });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/api/admin/ingest/tieba/cookie', requireAdmin, async (_req, res, next) => {
    try {
      await cookies.clear();
      res.status(204).end();
    } catch (err) {
      if (err instanceof CookieKeyError) {
        sendError(res, 'INTERNAL', 'cookie encryption key is not configured');
        return;
      }
      next(err);
    }
  });

  return router;
}
