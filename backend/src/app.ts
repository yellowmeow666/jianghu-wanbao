import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { sendError } from './errors.js';
import type { CardStore } from './cards/types.js';
import { createCardsRouter } from './cards/routes.js';
import { createIngestRouter } from './ingest/routes.js';
import type { PageFetcher } from './ingest/tieba/fetch.js';
import type { RateLimiter } from './ingest/rateLimit.js';

export interface CreateAppOptions {
  store: CardStore;
  adminToken?: string;
  now?: () => Date;
  /** Inject fake fetcher in tests; default real HTTP (not used in CI). */
  fetchPage?: PageFetcher;
  ingestRateLimit?: number;
  rateLimiter?: RateLimiter;
  /** 覆盖贴吧 Cookie 密文路径；默认 backend/data/tieba-cookie.enc 或 TIEBA_COOKIE_STORE。 */
  cookieStorePath?: string;
  /**
   * undefined 读 COOKIE_ENCRYPTION_KEY；null 强制当作未配置。
   * 测试传入独立密钥，避免碰到开发机环境变量。
   */
  cookieEncryptionKey?: string | null;
}

export function createApp({
  store,
  adminToken = process.env.ADMIN_TOKEN ?? '',
  now,
  fetchPage,
  ingestRateLimit,
  rateLimiter,
  cookieStorePath,
  cookieEncryptionKey,
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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
  app.use(
    createIngestRouter({
      store,
      adminToken,
      now,
      fetchPage,
      rateLimitPerMinute: ingestRateLimit,
      rateLimiter,
      cookieStorePath,
      cookieEncryptionKey,
    }),
  );

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
