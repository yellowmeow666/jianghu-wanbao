import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/cards/memoryStore.js';
import type { CardStore } from '../src/cards/types.js';
import type { FetchResult, PageFetcher } from '../src/ingest/tieba/fetch.js';
import { createRateLimiter } from '../src/ingest/rateLimit.js';
import { toPublic } from '../src/cards/types.js';

const ADMIN = 'test-admin-token';
const FIXED_NOW = new Date('2026-10-12T07:00:00.000Z');
const fix = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tieba');

function read(name: string): string {
  return fs.readFileSync(path.join(fix, name), 'utf8');
}

function fixtureFetcher(map: Record<string, FetchResult | (() => FetchResult)>): PageFetcher {
  return async (url: string) => {
    const key = Object.keys(map).find((k) => url.includes(k) || url === k);
    if (!key) {
      return { status: 500, body: 'unexpected url ' + url, url };
    }
    const v = map[key];
    return typeof v === 'function' ? v() : v;
  };
}

function build(opts: {
  store?: CardStore;
  fetchPage?: PageFetcher;
  ingestRateLimit?: number;
  rateLimiter?: ReturnType<typeof createRateLimiter>;
} = {}) {
  const store = opts.store ?? createMemoryStore();
  const app = createApp({
    store,
    adminToken: ADMIN,
    now: () => FIXED_NOW,
    fetchPage: opts.fetchPage,
    ingestRateLimit: opts.ingestRateLimit,
    rateLimiter: opts.rateLimiter,
    // 未配置 Cookie：不读环境里的密钥，行为与接入 Cookie 之前一致。
    cookieEncryptionKey: null,
  });
  return { app, store };
}

function admin(req: request.Test): request.Test {
  return req.set('X-Admin-Token', ADMIN);
}

const OK_URL = 'https://tieba.baidu.com/p/999001';

describe('POST /api/admin/ingest/tieba/by-url', () => {
  it('creates draft card from fixture HTML', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        '/p/999001': { status: 200, body: read('post-ok.html'), url: OK_URL },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'http://tieba.baidu.com/p/999001?see_lz=1',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.source_platform).toBe('tieba');
    expect(res.body.source_url).toBe(OK_URL);
    expect(res.body.clarified).toBe(false);
    expect(res.body.title).toContain('实锤');
    expect(res.body.summary.length).toBeLessThanOrEqual(200);
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0].at).toMatch(/2026-10-11/);

    const logs = await store.listIngestLogs();
    expect(logs[0].action).toBe('by-url');
    expect(logs[0].target).toBe(OK_URL);
    expect(logs[0].meta).toMatchObject({ used_cookie: false });
  });

  it('ALREADY_EXISTS with card_id on duplicate source_url', async () => {
    const fetchPage = fixtureFetcher({
      '/p/999001': { status: 200, body: read('post-ok.html'), url: OK_URL },
    });
    const { app } = build({ fetchPage });
    const first = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: OK_URL,
    });
    expect(first.status).toBe(201);
    const second = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: OK_URL,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_EXISTS');
    expect(second.body.card_id).toBe(first.body.id);
  });

  it('FETCH_FAILED does not write cards', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        '/p/1': { status: 500, body: 'oops', url: 'https://tieba.baidu.com/p/1' },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/1',
    });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('FETCH_FAILED');
    const cards = await store.listAdmin({ limit: 50, offset: 0 });
    expect(cards.length).toBe(0);
  });

  it('CAPTCHA does not write cards', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        '/p/2': {
          status: 200,
          body: read('post-captcha.html'),
          url: 'https://tieba.baidu.com/p/2',
        },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/2',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAPTCHA');
    expect((await store.listAdmin({ limit: 10, offset: 0 })).length).toBe(0);
    const logs = await store.listIngestLogs();
    expect(logs[0].meta).toMatchObject({ result: 'CAPTCHA', used_cookie: false });
  });

  it('NOT_FOUND for deleted post', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        '/p/3': {
          status: 200,
          body: read('post-404.html'),
          url: 'https://tieba.baidu.com/p/3',
        },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/3',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await store.listAdmin({ limit: 10, offset: 0 })).length).toBe(0);
  });

  it('import is alias of by-url', async () => {
    const { app } = build({
      fetchPage: fixtureFetcher({
        '/p/999001': { status: 200, body: read('post-ok.html'), url: OK_URL },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/import')).send({
      url: OK_URL,
    });
    expect(res.status).toBe(201);
    expect(res.body.source_url).toBe(OK_URL);
  });

  it('toPublic hides source_url', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        '/p/999001': { status: 200, body: read('post-ok.html'), url: OK_URL },
      }),
    });
    const created = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: OK_URL,
    });
    const card = await store.getById(created.body.id);
    expect(card?.source_url).toBe(OK_URL);
    const pub = toPublic(card!);
    expect(pub).not.toHaveProperty('source_url');
  });
});

describe('POST /api/admin/ingest/tieba/scan', () => {
  it('returns scored candidates and writes no cards', async () => {
    const { app, store } = build({
      fetchPage: fixtureFetcher({
        'tieba.baidu.com/f': {
          status: 200,
          body: read('list-ok.html'),
          url: 'https://tieba.baidu.com/f?kw=%E5%89%91%E7%BD%913',
        },
      }),
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/scan')).send({
      since: '2026-10-10 00:00:00',
      until: '2026-10-12 23:59:59',
      limit: 50,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
    // list has 八卦瓜 + 实锤塌房 within window; 攻略 score 0; 旧瓜 out of window
    expect(res.body.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of res.body.candidates) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.url).toMatch(/^https:\/\/tieba\.baidu\.com\/p\//);
    }
    expect((await store.listAdmin({ limit: 50, offset: 0 })).length).toBe(0);
    const logs = await store.listIngestLogs();
    expect(logs[0].action).toBe('scan');
    expect(logs[0].meta).toMatchObject({ used_cookie: false });
  });
});

describe('ingest rate limit', () => {
  it('returns 429 RATE_LIMITED after quota', async () => {
    const limiter = createRateLimiter(2);
    const { app } = build({
      ingestRateLimit: 2,
      rateLimiter: limiter,
      fetchPage: fixtureFetcher({
        '/p/': () => ({
          status: 500,
          body: 'x',
          url: 'https://tieba.baidu.com/p/1',
        }),
      }),
    });
    const url = 'https://tieba.baidu.com/p/100';
    await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({ url });
    await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/101',
    });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/102',
    });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('ingest auth', () => {
  it('requires admin token', async () => {
    const { app } = build({
      fetchPage: async () => ({ status: 200, body: '', url: '' }),
    });
    const res = await request(app)
      .post('/api/admin/ingest/tieba/by-url')
      .send({ url: OK_URL });
    expect(res.status).toBe(401);
  });

  it('rejects invalid url with INVALID_URL', async () => {
    const { app } = build();
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://example.com/not-tieba',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });


  it('rejects non-tieba url on import with INVALID_URL', async () => {
    const { app } = build();
    const res = await admin(request(app).post('/api/admin/ingest/tieba/import')).send({
      url: 'https://www.baidu.com/',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('rejects missing url with INVALID_URL not INVALID_BODY', async () => {
    const { app } = build();
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
    expect(res.body.error.code).not.toBe('INVALID_BODY');
  });

});
