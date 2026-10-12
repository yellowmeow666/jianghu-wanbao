import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendError } from '../errors.js';
import type { CardStore } from './types.js';
import { toPublic } from './types.js';
import {
  ValidationError,
  assertPublishable,
  parseAdminListQuery,
  parseCreateBody,
  parseIdParam,
  parsePatchBody,
  parsePublicScope,
} from './validate.js';


function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] ?? '' : raw;
}

export interface CardsRouterOptions {
  store: CardStore;
  adminToken: string;
  now?: () => Date;
}

function handleValidation(err: unknown, res: Response): boolean {
  if (err instanceof ValidationError) {
    sendError(res, 'INVALID_BODY', err.message);
    return true;
  }
  return false;
}

export function createCardsRouter(opts: CardsRouterOptions): Router {
  const { store, adminToken } = opts;
  const now = opts.now ?? (() => new Date());
  const router = Router();

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('X-Admin-Token');
    if (!adminToken || token !== adminToken) {
      sendError(res, 'UNAUTHORIZED');
      return;
    }
    next();
  };

  // ——— C-end ———
  router.get('/api/cards', async (req, res, next) => {
    try {
      const scope = parsePublicScope(req.query.scope);
      const items = await store.listPublished(scope, now());
      res.json({ items: items.map(toPublic) });
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  router.get('/api/cards/:id', async (req, res, next) => {
    try {
      const id = parseIdParam(paramId(req.params.id));
      const card = await store.getById(id);
      if (!card || card.status !== 'published') {
        sendError(res, 'NOT_FOUND');
        return;
      }
      res.json(toPublic(card));
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  // ——— Admin ———
  router.get('/api/admin/cards', requireAdmin, async (req, res, next) => {
    try {
      const q = parseAdminListQuery(req.query as Record<string, unknown>);
      const items = await store.listAdmin({
        statuses: q.statuses,
        limit: q.limit,
        offset: q.offset,
      });
      res.json({ items });
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  router.post('/api/admin/cards', requireAdmin, async (req, res, next) => {
    try {
      const input = parseCreateBody(req.body);
      const card = await store.create(input, now());
      res.status(201).json(card);
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  router.patch('/api/admin/cards/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseIdParam(paramId(req.params.id));
      const patch = parsePatchBody(req.body);
      const card = await store.update(id, patch, now());
      if (!card) {
        sendError(res, 'NOT_FOUND');
        return;
      }
      res.json(card);
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  router.post('/api/admin/cards/:id/publish', requireAdmin, async (req, res, next) => {
    try {
      const id = parseIdParam(paramId(req.params.id));
      const existing = await store.getById(id);
      if (!existing) {
        sendError(res, 'NOT_FOUND');
        return;
      }
      assertPublishable(existing);
      const card = await store.setStatus(id, 'published', now());
      res.json(card);
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  router.post('/api/admin/cards/:id/unpublish', requireAdmin, async (req, res, next) => {
    try {
      const id = parseIdParam(paramId(req.params.id));
      const existing = await store.getById(id);
      if (!existing) {
        sendError(res, 'NOT_FOUND');
        return;
      }
      // Default: unpublish → archived
      const card = await store.setStatus(id, 'archived', now());
      res.json(card);
    } catch (err) {
      if (handleValidation(err, res)) return;
      next(err);
    }
  });

  return router;
}
