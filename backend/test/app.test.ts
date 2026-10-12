import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/cards/memoryStore.js';
import type { CardStore } from '../src/cards/types.js';

const ADMIN = 'test-admin-token';

/** Fixed "now" = 2026-10-12 15:00 Asia/Shanghai = 2026-10-12T07:00:00.000Z */
const FIXED_NOW = new Date('2026-10-12T07:00:00.000Z');

function build(store?: CardStore, now: () => Date = () => FIXED_NOW) {
  const s = store ?? createMemoryStore();
  const app = createApp({ store: s, adminToken: ADMIN, now });
  return { app, store: s };
}

function admin(req: request.Test): request.Test {
  return req.set('X-Admin-Token', ADMIN);
}

const fullBody = {
  title: '江湖第一刀',
  summary: '传闻某大侠出关',
  timeline: [{ at: '2026-10-12T09:00:00+08:00', text: '有人目击出关' }],
  source_platform: 'weibo',
  source_type: 'rumor',
  clarified: false,
};

describe('admin auth', () => {
  it('rejects missing X-Admin-Token', async () => {
    const { app } = build();
    const res = await request(app).get('/api/admin/cards');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong X-Admin-Token', async () => {
    const { app } = build();
    const res = await request(app)
      .get('/api/admin/cards')
      .set('X-Admin-Token', 'nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('admin create & list', () => {
  let app: ReturnType<typeof build>['app'];

  beforeEach(() => {
    ({ app } = build());
  });

  it('creates a draft with empty optional fields', async () => {
    const res = await admin(request(app).post('/api/admin/cards')).send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.title).toBe('');
    expect(res.body.summary).toBe('');
    expect(res.body.timeline).toEqual([]);
    expect(res.body.id).toBeTypeOf('number');
  });

  it('lists admin cards and filters by comma-separated status', async () => {
    await admin(request(app).post('/api/admin/cards')).send({ title: 'a' });
    await admin(request(app).post('/api/admin/cards')).send({ title: 'b' });
    const all = await admin(request(app).get('/api/admin/cards'));
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBe(2);

    const filtered = await admin(
      request(app).get('/api/admin/cards').query({ status: 'draft,pending' }),
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.length).toBe(2);

    const none = await admin(
      request(app).get('/api/admin/cards').query({ status: 'published' }),
    );
    expect(none.body.items.length).toBe(0);
  });
});

describe('publish / unpublish / C-end', () => {
  it('publish with missing fields returns INVALID_BODY', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send({
      title: 'only title',
    });
    const id = created.body.id as number;
    const res = await admin(request(app).post(`/api/admin/cards/${id}/publish`));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('publish ok → C-end today/week list and detail', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send(fullBody);
    const id = created.body.id as number;

    const pub = await admin(request(app).post(`/api/admin/cards/${id}/publish`));
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');

    const today = await request(app).get('/api/cards').query({ scope: 'today' });
    expect(today.status).toBe(200);
    expect(today.body.items.length).toBe(1);
    expect(today.body.items[0].id).toBe(id);
    expect(today.body.items[0].status).toBe('published');
    expect(today.body.items[0]).toHaveProperty('created_at');
    expect(today.body.items[0]).toHaveProperty('updated_at');

    const week = await request(app).get('/api/cards').query({ scope: 'week' });
    expect(week.status).toBe(200);
    expect(week.body.items.length).toBe(1);

    const detail = await request(app).get(`/api/cards/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.title).toBe(fullBody.title);
    expect(detail.body.timeline).toEqual(fullBody.timeline);
    expect(detail.body).toHaveProperty('created_at');
    expect(detail.body).toHaveProperty('updated_at');
  });

  it('non-published detail returns 404 NOT_FOUND', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send(fullBody);
    const id = created.body.id as number;
    const res = await request(app).get(`/api/cards/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('unpublish → archived and gone from C-end', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send(fullBody);
    const id = created.body.id as number;
    await admin(request(app).post(`/api/admin/cards/${id}/publish`));

    const un = await admin(request(app).post(`/api/admin/cards/${id}/unpublish`));
    expect(un.status).toBe(200);
    expect(un.body.status).toBe('archived');

    const today = await request(app).get('/api/cards').query({ scope: 'today' });
    expect(today.body.items.length).toBe(0);

    const detail = await request(app).get(`/api/cards/${id}`);
    expect(detail.status).toBe(404);
  });

  it('re-publish archived card after filling fields', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send(fullBody);
    const id = created.body.id as number;
    await admin(request(app).post(`/api/admin/cards/${id}/publish`));
    await admin(request(app).post(`/api/admin/cards/${id}/unpublish`));

    const again = await admin(request(app).post(`/api/admin/cards/${id}/publish`));
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('published');

    const today = await request(app).get('/api/cards').query({ scope: 'today' });
    expect(today.body.items.length).toBe(1);
  });
});

describe('validation & patch', () => {
  it('invalid scope → INVALID_BODY', async () => {
    const { app } = build();
    const res = await request(app).get('/api/cards').query({ scope: 'month' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('missing scope → INVALID_BODY', async () => {
    const { app } = build();
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('PATCH status=published → INVALID_BODY tip to use publish', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send(fullBody);
    const id = created.body.id as number;
    const res = await admin(request(app).patch(`/api/admin/cards/${id}`)).send({
      status: 'published',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
    expect(String(res.body.error.message)).toMatch(/publish/i);
  });

  it('PATCH can set pending and content', async () => {
    const { app } = build();
    const created = await admin(request(app).post('/api/admin/cards')).send({});
    const id = created.body.id as number;
    const res = await admin(request(app).patch(`/api/admin/cards/${id}`)).send({
      title: '改标题',
      status: 'pending',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('改标题');
    expect(res.body.status).toBe('pending');
  });

  it('admin list limit max 100', async () => {
    const { app } = build();
    const res = await admin(request(app).get('/api/admin/cards').query({ limit: 101 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  it('week scope includes card from 6 days ago, excludes 7 days ago', async () => {
    const sixDaysAgo = new Date('2026-10-06T08:00:00.000Z'); // still within 7 days ending Oct 12 SH
    const sevenDaysAgo = new Date('2026-10-05T08:00:00.000Z'); // Oct 5 SH = outside week window

    const olderStore = createMemoryStore();
    const appOlder = createApp({
      store: olderStore,
      adminToken: ADMIN,
      now: () => sevenDaysAgo,
    });
    const c1 = await admin(request(appOlder).post('/api/admin/cards')).send(fullBody);
    await admin(request(appOlder).post(`/api/admin/cards/${c1.body.id}/publish`));

    const appSix = createApp({
      store: olderStore,
      adminToken: ADMIN,
      now: () => sixDaysAgo,
    });
    const c2 = await admin(request(appSix).post('/api/admin/cards')).send({
      ...fullBody,
      title: 'six days',
    });
    await admin(request(appSix).post(`/api/admin/cards/${c2.body.id}/publish`));

    const appNow = createApp({
      store: olderStore,
      adminToken: ADMIN,
      now: () => FIXED_NOW,
    });
    const week = await request(appNow).get('/api/cards').query({ scope: 'week' });
    expect(week.status).toBe(200);
    const ids = week.body.items.map((i: { id: number }) => i.id);
    expect(ids).toContain(c2.body.id);
    expect(ids).not.toContain(c1.body.id);

    const today = await request(appNow).get('/api/cards').query({ scope: 'today' });
    expect(today.body.items.length).toBe(0);
  });
});

describe('CORS for admin Vite', () => {
  it('allows localhost:5173 and X-Admin-Token on preflight', async () => {
    const { app } = build();
    const res = await request(app)
      .options('/api/admin/cards')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'X-Admin-Token')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Admin-Token/i);
  });
});
