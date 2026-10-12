import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../src/app.js';
import { createPoolFromEnv } from '../src/db.js';
import { createMysqlStore } from '../src/cards/mysqlStore.js';

const ADMIN = process.env.ADMIN_TOKEN || 'ci-admin-token';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeMysql = hasDb ? describe : describe.skip;

describeMysql('mysql integration', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    pool = createPoolFromEnv();
    const sqlPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../sql/001_cards.sql',
    );
    const cleaned = fs
      .readFileSync(sqlPath, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    await pool.query(cleaned);
    await pool.query('DELETE FROM cards');
    app = createApp({
      store: createMysqlStore(pool),
      adminToken: ADMIN,
      now: () => new Date('2026-10-12T08:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('create → publish → C-end list/detail; draft not visible', async () => {
    const createRes = await request(app)
      .post('/api/admin/cards')
      .set('X-Admin-Token', ADMIN)
      .send({
        title: '集成测瓜',
        summary: '一条真库冒烟',
        timeline: [{ at: '2026-10-12T07:00:00.000Z', text: '节点一' }],
        source_platform: '贴吧',
        source_type: '传闻',
        clarified: false,
      })
      .expect(201);

    const id = createRes.body.id as number;

    const before = await request(app).get('/api/cards?scope=today').expect(200);
    expect(before.body.items.some((c: { id: number }) => c.id === id)).toBe(false);
    await request(app).get(`/api/cards/${id}`).expect(404);

    await request(app)
      .post(`/api/admin/cards/${id}/publish`)
      .set('X-Admin-Token', ADMIN)
      .expect(200);

    const list = await request(app).get('/api/cards?scope=today').expect(200);
    expect(list.body.items.some((c: { id: number }) => c.id === id)).toBe(true);

    const detail = await request(app).get(`/api/cards/${id}`).expect(200);
    expect(detail.body.title).toBe('集成测瓜');
    expect(detail.body.status).toBe('published');
  });
});
