import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/cards/memoryStore.js';
import { createHttpFetcher, type FetchInit, type PageFetcher } from '../src/ingest/tieba/fetch.js';
import { isTiebaCookieDomain, parseCookieContent } from '../src/ingest/tieba/cookieParse.js';
import { decodeCookieKey } from '../src/ingest/tieba/cookieStore.js';

const ADMIN = 'test-admin-token';
const FIXED_NOW = new Date('2026-10-12T07:00:00.000Z');
const SECRET = 'BDUSS_PLAINTEXT_SHOULD_NOT_LEAK_9f3a';
const KEY_HEX = randomBytes(32).toString('hex');
const KEY_B64 = randomBytes(32).toString('base64');

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tieba');

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tieba-ck-'));
  dirs.push(dir);
  return path.join(dir, 'tieba-cookie.enc');
}

function admin(req: request.Test): request.Test {
  return req.set('X-Admin-Token', ADMIN);
}

function netscape(secret: string): string {
  return [
    '# Netscape HTTP Cookie File',
    `#HttpOnly_.baidu.com\tTRUE\t/\tTRUE\t0\tBDUSS\t${secret}`,
    'tieba.baidu.com\tFALSE\t/\tFALSE\t0\tSTOKEN\tstok',
    '.example.com\tTRUE\t/\tFALSE\t0\tOTHER\tnope',
    '',
  ].join('\n');
}

function jsonCookies(secret: string): string {
  return JSON.stringify([
    { name: 'BDUSS', value: secret, domain: '.baidu.com', path: '/' },
    { name: 'OTHER', value: 'nope', domain: 'example.com', path: '/' },
  ]);
}

function build(opts: {
  fetchPage?: PageFetcher;
  cookieStorePath: string;
  cookieEncryptionKey?: string | null;
}) {
  const store = createMemoryStore();
  const app = createApp({
    store,
    adminToken: ADMIN,
    now: () => FIXED_NOW,
    fetchPage: opts.fetchPage,
    cookieStorePath: opts.cookieStorePath,
    cookieEncryptionKey: opts.cookieEncryptionKey === undefined ? KEY_HEX : opts.cookieEncryptionKey,
  });
  return { app, store };
}

function spyFetcher(status: number, body: string): {
  fetcher: PageFetcher;
  calls: Array<{ url: string; init?: FetchInit }>;
} {
  const calls: Array<{ url: string; init?: FetchInit }> = [];
  const fetcher: PageFetcher = async (url, init) => {
    calls.push({ url, init });
    return { status, body, url };
  };
  return { fetcher, calls };
}

describe('cookie parsers', () => {
  it('keeps tieba/baidu cookies and drops unrelated domains', () => {
    expect(parseCookieContent('netscape', netscape(SECRET))).toBe(`BDUSS=${SECRET}; STOKEN=stok`);
    expect(parseCookieContent('json', jsonCookies(SECRET))).toBe(`BDUSS=${SECRET}`);
    expect(isTiebaCookieDomain('.baidu.com')).toBe(true);
    expect(isTiebaCookieDomain('tieba.baidu.com')).toBe(true);
    expect(isTiebaCookieDomain(undefined)).toBe(true);
    expect(isTiebaCookieDomain('www.baidu.com')).toBe(false);
    expect(isTiebaCookieDomain('passport.baidu.com')).toBe(false);
  });

  it('rejects empty, foreign-only, and malformed payloads', () => {
    expect(() => parseCookieContent('xml', 'x')).toThrow(/netscape or json/);
    expect(() => parseCookieContent('json', '{')).toThrow(/JSON array/);
    expect(() => parseCookieContent('json', '{"name":"BDUSS","value":"x"}')).toThrow(/JSON array/);
    expect(() =>
      parseCookieContent('json', JSON.stringify([{ name: 'A', value: 'B', domain: 'evil.com' }])),
    ).toThrow(/no cookies applicable/);
    expect(() => parseCookieContent('netscape', '# just a comment\n')).toThrow(/no cookies applicable/);
    expect(() =>
      parseCookieContent('json', JSON.stringify([{ name: 'BDUSS', value: 'a;b', domain: '.baidu.com' }])),
    ).toThrow(/cannot be sent/);
  });

  it('decodes 32-byte hex and base64 keys only', () => {
    expect(decodeCookieKey(KEY_HEX)?.length).toBe(32);
    expect(decodeCookieKey(KEY_B64)?.equals(Buffer.from(KEY_B64, 'base64'))).toBe(true);
    expect(decodeCookieKey('abcd')).toBeNull();
    expect(decodeCookieKey('')).toBeNull();
    expect(decodeCookieKey(null)).toBeNull();
  });
});

describe('admin cookie API', () => {
  it('PUT/GET/DELETE happy path never returns plaintext', async () => {
    const cookieStorePath = await tempFile();
    const { app } = build({ cookieStorePath });

    const put = await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'netscape',
      content: netscape(SECRET),
    });
    expect(put.status).toBe(204);
    expect(put.text).toBe('');
    expect(put.text).not.toContain(SECRET);

    const got = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(got.status).toBe(200);
    expect(Object.keys(got.body).sort()).toEqual(['status', 'updated_at']);
    expect(got.body).toEqual({ status: 'valid', updated_at: FIXED_NOW.toISOString() });
    expect(JSON.stringify(got.body)).not.toContain(SECRET);
    expect(JSON.stringify(got.body)).not.toContain('BDUSS');
    expect(JSON.stringify(got.headers)).not.toContain(SECRET);

    const stored = await fs.readFile(cookieStorePath, 'utf8');
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain('AES-256-GCM');

    const del = await admin(request(app).delete('/api/admin/ingest/tieba/cookie'));
    expect(del.status).toBe(204);
    expect(del.text).not.toContain(SECRET);

    const after = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(after.body).toEqual({ status: 'missing', updated_at: null });
    await expect(fs.access(cookieStorePath)).rejects.toThrow();
  });

  it('accepts JSON cookies with a base64 key', async () => {
    const cookieStorePath = await tempFile();
    const { app } = build({ cookieStorePath, cookieEncryptionKey: KEY_B64 });
    const put = await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'json',
      content: jsonCookies(SECRET),
    });
    expect(put.status).toBe(204);
    const got = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(Object.keys(got.body).sort()).toEqual(['status', 'updated_at']);
    expect(got.body.status).toBe('valid');
    expect(JSON.stringify(got.body)).not.toContain(SECRET);
  });

  it('PUT bad format or unusable content is INVALID_BODY', async () => {
    const cookieStorePath = await tempFile();
    const { app } = build({ cookieStorePath });
    const cases = [
      { format: 'xml', content: netscape(SECRET) },
      { format: 'json', content: 'not-json' },
      { format: 'netscape', content: 'hello world' },
      { format: 'json', content: JSON.stringify([{ name: 'A', value: 'B', domain: 'evil.com' }]) },
      { format: 'netscape', content: '' },
    ];
    for (const body of cases) {
      const res = await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_BODY');
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    const got = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(got.body.status).toBe('missing');
  });

  it('requires admin token', async () => {
    const cookieStorePath = await tempFile();
    const { app } = build({ cookieStorePath });
    const put = await request(app).put('/api/admin/ingest/tieba/cookie').send({
      format: 'json',
      content: jsonCookies(SECRET),
    });
    expect(put.status).toBe(401);
    expect(put.body.error.code).toBe('UNAUTHORIZED');
    const got = await request(app).get('/api/admin/ingest/tieba/cookie');
    expect(got.status).toBe(401);
    const del = await request(app).delete('/api/admin/ingest/tieba/cookie');
    expect(del.status).toBe(401);
  });

  it('write APIs return INTERNAL when the encryption key is missing; GET stays missing', async () => {
    const cookieStorePath = await tempFile();
    const { app } = build({ cookieStorePath, cookieEncryptionKey: null });
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      const put = await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send({
        format: 'json',
        content: jsonCookies(SECRET),
      });
      expect(put.status).toBe(500);
      expect(put.body.error.code).toBe('INTERNAL');
      expect(JSON.stringify(put.body)).not.toContain(SECRET);

      const del = await admin(request(app).delete('/api/admin/ingest/tieba/cookie'));
      expect(del.status).toBe(500);
      expect(del.body.error.code).toBe('INTERNAL');

      const got = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
      expect(got.body).toEqual({ status: 'missing', updated_at: null });
      expect(errors.join('\n')).toContain('COOKIE_ENCRYPTION_KEY');
      expect(errors.join('\n')).not.toContain(SECRET);
      await expect(fs.access(cookieStorePath)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ingest attaches cookie only when configured', () => {
  it('does not send Cookie when none is stored', async () => {
    const cookieStorePath = await tempFile();
    const { fetcher, calls } = spyFetcher(200, fixture('post-ok.html'));
    const { app, store } = build({ cookieStorePath, fetchPage: fetcher });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/999001',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toBeUndefined();
    const logs = await store.listIngestLogs();
    expect(logs[0].meta).toMatchObject({ used_cookie: false });
    expect(JSON.stringify(logs[0].meta)).not.toContain(SECRET);
  });

  it('E1 captcha without a cookie leaves status missing and writes no card', async () => {
    const cookieStorePath = await tempFile();
    const { fetcher, calls } = spyFetcher(200, fixture('post-captcha.html'));
    const { app, store } = build({ cookieStorePath, fetchPage: fetcher });
    const res = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/2',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAPTCHA');
    expect(calls[0]?.init).toBeUndefined();
    expect((await store.listAdmin({ limit: 10, offset: 0 })).length).toBe(0);
    const status = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(status.body).toEqual({ status: 'missing', updated_at: null });
  });

  it('sends Cookie on by-url, import, and scan when valid', async () => {
    const cookieStorePath = await tempFile();
    const { fetcher, calls } = spyFetcher(200, fixture('post-ok.html'));
    const scanSpy = spyFetcher(200, fixture('list-ok.html'));
    const { app, store } = build({ cookieStorePath, fetchPage: fetcher });
    const put = await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'json',
      content: jsonCookies(SECRET),
    });
    expect(put.status).toBe(204);

    const byUrl = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/999001',
    });
    expect(byUrl.status).toBe(201);
    expect(byUrl.body.status).toBe('draft');
    expect(JSON.stringify(byUrl.body)).not.toContain(SECRET);
    expect(calls[0]?.init?.headers?.Cookie).toBe(`BDUSS=${SECRET}`);

    const imported = await admin(request(app).post('/api/admin/ingest/tieba/import')).send({
      url: 'https://tieba.baidu.com/p/999002',
    });
    expect(imported.status).toBe(201);
    expect(calls[1]?.init?.headers?.Cookie).toBe(`BDUSS=${SECRET}`);

    const scanApp = createApp({
      store,
      adminToken: ADMIN,
      now: () => FIXED_NOW,
      fetchPage: scanSpy.fetcher,
      cookieStorePath,
      cookieEncryptionKey: KEY_HEX,
    });
    const scan = await admin(request(scanApp).post('/api/admin/ingest/tieba/scan')).send({
      since: '2026-10-10 00:00:00',
      until: '2026-10-12 23:59:59',
    });
    expect(scan.status).toBe(200);
    expect(scan.body.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(scan.body)).not.toContain(SECRET);
    expect(scanSpy.calls[0]?.init?.headers?.Cookie).toBe(`BDUSS=${SECRET}`);

    const cardId = byUrl.body.id as number;
    const today = await request(app).get('/api/cards?scope=today');
    const week = await request(app).get('/api/cards?scope=week');
    expect(today.body.items.find((item: { id: number }) => item.id === cardId)).toBeUndefined();
    expect(week.body.items.find((item: { id: number }) => item.id === cardId)).toBeUndefined();
    const detail = await request(app).get(`/api/cards/${cardId}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('NOT_FOUND');
    const adminList = await admin(request(app).get('/api/admin/cards'));
    expect(adminList.body.items.some((item: { id: number; status: string }) => item.id === cardId && item.status === 'draft')).toBe(true);

    const logs = await store.listIngestLogs();
    expect(logs.some((log) => log.action === 'by-url' && log.meta?.used_cookie === true)).toBe(true);
    expect(logs.some((log) => log.action === 'import' && log.meta?.used_cookie === true)).toBe(true);
    expect(logs.some((log) => log.action === 'scan' && log.meta?.used_cookie === true)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it('marks the cookie expired after a captcha wall and stops sending it', async () => {
    const cookieStorePath = await tempFile();
    const first = spyFetcher(200, fixture('post-captcha.html'));
    const { app, store } = build({ cookieStorePath, fetchPage: first.fetcher });
    await admin(request(app).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'netscape',
      content: netscape(SECRET),
    });
    const blocked = await admin(request(app).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/999001',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CAPTCHA');
    expect(blocked.body.cookie_status).toBe('expired');
    expect(JSON.stringify(blocked.body)).not.toContain(SECRET);
    expect(first.calls[0]?.init?.headers?.Cookie).toContain(SECRET);
    expect((await store.listAdmin({ limit: 10, offset: 0 })).length).toBe(0);

    const status = await admin(request(app).get('/api/admin/ingest/tieba/cookie'));
    expect(Object.keys(status.body).sort()).toEqual(['status', 'updated_at']);
    expect(status.body).toEqual({ status: 'expired', updated_at: FIXED_NOW.toISOString() });
    expect(JSON.stringify(status.body)).not.toContain(SECRET);

    const second = spyFetcher(200, fixture('post-ok.html'));
    const retryApp = createApp({
      store,
      adminToken: ADMIN,
      now: () => FIXED_NOW,
      fetchPage: second.fetcher,
      cookieStorePath,
      cookieEncryptionKey: KEY_HEX,
    });
    const again = await admin(request(retryApp).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/999002',
    });
    expect(again.status).toBe(201);
    expect(second.calls[0]?.init).toBeUndefined();
    const logs = await store.listIngestLogs();
    expect(logs.find((log) => log.meta?.result === 'CAPTCHA')?.meta).toMatchObject({
      used_cookie: true,
    });
    expect(logs[0].meta).toMatchObject({ used_cookie: false });

    const bad = await admin(request(retryApp).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'json',
      content: '[]',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_BODY');
    const stillExpired = await admin(request(retryApp).get('/api/admin/ingest/tieba/cookie'));
    expect(stillExpired.body.status).toBe('expired');

    const restored = await admin(request(retryApp).put('/api/admin/ingest/tieba/cookie')).send({
      format: 'json',
      content: jsonCookies(SECRET),
    });
    expect(restored.status).toBe(204);
    const validAgain = await admin(request(retryApp).get('/api/admin/ingest/tieba/cookie'));
    expect(validAgain.body.status).toBe('valid');
    expect(JSON.stringify(validAgain.body)).not.toContain(SECRET);

    const third = spyFetcher(200, fixture('post-ok.html'));
    const againApp = createApp({
      store,
      adminToken: ADMIN,
      now: () => FIXED_NOW,
      fetchPage: third.fetcher,
      cookieStorePath,
      cookieEncryptionKey: KEY_HEX,
    });
    const taken = await admin(request(againApp).post('/api/admin/ingest/tieba/by-url')).send({
      url: 'https://tieba.baidu.com/p/999003',
    });
    expect(taken.status).toBe(201);
    expect(taken.body.status).toBe('draft');
    expect(third.calls[0]?.init?.headers?.Cookie).toBe(`BDUSS=${SECRET}`);

    const del = await admin(request(againApp).delete('/api/admin/ingest/tieba/cookie'));
    expect(del.status).toBe(204);
    const cleared = await admin(request(againApp).get('/api/admin/ingest/tieba/cookie'));
    expect(cleared.body).toEqual({ status: 'missing', updated_at: null });
  });
});

describe('createHttpFetcher', () => {
  it('forwards Cookie only when the caller supplies it', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init);
      return new Response('<html></html>', { status: 200 });
    }) as typeof fetch;
    try {
      const fetcher = createHttpFetcher();
      await fetcher('https://tieba.baidu.com/p/1');
      await fetcher('https://tieba.baidu.com/p/1', { headers: { Cookie: `BDUSS=${SECRET}` } });
      const first = seen[0]?.headers as Record<string, string>;
      const second = seen[1]?.headers as Record<string, string>;
      expect(first.Cookie).toBeUndefined();
      expect(first['User-Agent']).toBeTruthy();
      expect(second.Cookie).toBe(`BDUSS=${SECRET}`);
      expect(second['User-Agent']).toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });
});
