import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { sendError } from './errors.js';
import type { CardStore } from './cards/types.js';
import { createCardsRouter } from './cards/routes.js';

export interface CreateAppOptions {
  store: CardStore;
  adminToken?: string;
  now?: () => Date;
}

export function createApp({
  store,
  adminToken = process.env.ADMIN_TOKEN ?? '',
  now,
}: CreateAppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Admin Vite (5173) and local tooling; expose admin token header for browsers
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    const allowed = new Set([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(createCardsRouter({ store, adminToken, now }));

  app.use((_req, res) => sendError(res, 'NOT_FOUND'));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large') {
      sendError(res, 'INVALID_BODY', 'malformed or too large JSON body');
      return;
    }
    console.error(err);
    sendError(res, 'INTERNAL');
  });

  return app;
}
