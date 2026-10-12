import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type {
  Card,
  CardStatus,
  CardStore,
  CreateCardInput,
  IngestLog,
  IngestLogInput,
  ListAdminOptions,
  PatchCardInput,
  PublicScope,
  TimelineItem,
} from './types.js';
import { publishedRange, toIso } from './time.js';

interface CardRow extends RowDataPacket {
  id: number;
  title: string;
  summary: string;
  timeline: TimelineItem[] | string;
  source_platform: string;
  source_type: string;
  clarified: number | boolean;
  status: CardStatus;
  source_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface IngestLogRow extends RowDataPacket {
  id: number;
  actor: string;
  action: string;
  target: string;
  meta: Record<string, unknown> | string | null;
  created_at: Date | string;
}

function parseTimelineField(raw: TimelineItem[] | string): TimelineItem[] {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as TimelineItem[];
  }
  return raw ?? [];
}

function toSqlDateTime(iso: string): string {
  return iso.slice(0, 23).replace('T', ' ');
}

function rowToCard(row: CardRow): Card {
  const created =
    row.created_at instanceof Date ? toIso(row.created_at) : new Date(row.created_at).toISOString();
  const updated =
    row.updated_at instanceof Date ? toIso(row.updated_at) : new Date(row.updated_at).toISOString();
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    timeline: parseTimelineField(row.timeline),
    source_platform: row.source_platform,
    source_type: row.source_type,
    clarified: Boolean(row.clarified),
    status: row.status,
    source_url: row.source_url ?? null,
    created_at: created,
    updated_at: updated,
  };
}

function rowToIngestLog(row: IngestLogRow): IngestLog {
  const created =
    row.created_at instanceof Date ? toIso(row.created_at) : new Date(row.created_at).toISOString();
  let meta: Record<string, unknown> | null = null;
  if (row.meta != null) {
    meta = typeof row.meta === 'string' ? (JSON.parse(row.meta) as Record<string, unknown>) : row.meta;
  }
  return {
    id: Number(row.id),
    actor: row.actor,
    action: row.action,
    target: row.target,
    meta,
    created_at: created,
  };
}

export function createMysqlStore(pool: Pool): CardStore {
  return {
    async create(input: CreateCardInput, now: Date): Promise<Card> {
      const title = input.title ?? '';
      const summary = input.summary ?? '';
      const timeline = input.timeline ?? [];
      const source_platform = input.source_platform ?? '';
      const source_type = input.source_type ?? '';
      const clarified = input.clarified ?? false;
      const source_url =
        input.source_url === undefined || input.source_url === null || input.source_url === ''
          ? null
          : input.source_url;
      const iso = toIso(now);
      const dt = toSqlDateTime(iso);
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO cards
          (title, summary, timeline, source_platform, source_type, clarified, status, source_url, created_at, updated_at)
         VALUES (?, ?, CAST(? AS JSON), ?, ?, ?, 'draft', ?, ?, ?)`,
        [
          title,
          summary,
          JSON.stringify(timeline),
          source_platform,
          source_type,
          clarified ? 1 : 0,
          source_url,
          dt,
          dt,
        ],
      );
      const id = result.insertId;
      const card = await this.getById(id);
      if (!card) throw new Error('failed to load created card');
      return card;
    },

    async getById(id: number): Promise<Card | null> {
      const [rows] = await pool.execute<CardRow[]>('SELECT * FROM cards WHERE id = ?', [id]);
      if (!rows[0]) return null;
      return rowToCard(rows[0]);
    },

    async getBySourceUrl(url: string): Promise<Card | null> {
      const [rows] = await pool.execute<CardRow[]>('SELECT * FROM cards WHERE source_url = ?', [
        url,
      ]);
      if (!rows[0]) return null;
      return rowToCard(rows[0]);
    },

    async listAdmin(opts: ListAdminOptions): Promise<Card[]> {
      const params: unknown[] = [];
      let sql = 'SELECT * FROM cards';
      if (opts.statuses && opts.statuses.length > 0) {
        const placeholders = opts.statuses.map(() => '?').join(',');
        sql += ` WHERE status IN (${placeholders})`;
        params.push(...opts.statuses);
      }
      const limit = Math.trunc(Number(opts.limit));
      const offset = Math.trunc(Number(opts.offset));
      if (!Number.isFinite(limit) || limit < 0 || !Number.isFinite(offset) || offset < 0) {
        throw new Error('invalid limit/offset');
      }
      sql += ` ORDER BY updated_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;
      const [rows] = await pool.execute<CardRow[]>(sql, params);
      return rows.map(rowToCard);
    },

    async listPublished(scope: PublicScope, now: Date): Promise<Card[]> {
      const { from, toExclusive } = publishedRange(scope, now);
      const fromSql = toSqlDateTime(toIso(from));
      const toSql = toSqlDateTime(toIso(toExclusive));
      const [rows] = await pool.execute<CardRow[]>(
        `SELECT * FROM cards
          WHERE status = 'published'
            AND updated_at >= ?
            AND updated_at < ?
          ORDER BY updated_at DESC, id DESC`,
        [fromSql, toSql],
      );
      return rows.map(rowToCard);
    },

    async update(id: number, patch: PatchCardInput, now: Date): Promise<Card | null> {
      const existing = await this.getById(id);
      if (!existing) return null;
      const title = patch.title !== undefined ? patch.title : existing.title;
      const summary = patch.summary !== undefined ? patch.summary : existing.summary;
      const timeline = patch.timeline !== undefined ? patch.timeline : existing.timeline;
      const source_platform =
        patch.source_platform !== undefined ? patch.source_platform : existing.source_platform;
      const source_type = patch.source_type !== undefined ? patch.source_type : existing.source_type;
      const clarified = patch.clarified !== undefined ? patch.clarified : existing.clarified;
      const status = patch.status !== undefined ? patch.status : existing.status;
      const iso = toIso(now);
      await pool.execute(
        `UPDATE cards SET
          title = ?, summary = ?, timeline = CAST(? AS JSON),
          source_platform = ?, source_type = ?, clarified = ?,
          status = ?, updated_at = ?
         WHERE id = ?`,
        [
          title,
          summary,
          JSON.stringify(timeline),
          source_platform,
          source_type,
          clarified ? 1 : 0,
          status,
          toSqlDateTime(iso),
          id,
        ],
      );
      return this.getById(id);
    },

    async setStatus(id: number, status: CardStatus, now: Date): Promise<Card | null> {
      const existing = await this.getById(id);
      if (!existing) return null;
      const iso = toIso(now);
      await pool.execute('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        toSqlDateTime(iso),
        id,
      ]);
      return this.getById(id);
    },

    async appendIngestLog(input: IngestLogInput, now: Date): Promise<IngestLog> {
      const iso = toIso(now);
      const metaJson = input.meta == null ? null : JSON.stringify(input.meta);
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO ingest_logs (actor, action, target, meta, created_at)
         VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
        [input.actor, input.action, input.target, metaJson, toSqlDateTime(iso)],
      );
      const [rows] = await pool.execute<IngestLogRow[]>(
        'SELECT * FROM ingest_logs WHERE id = ?',
        [result.insertId],
      );
      if (!rows[0]) throw new Error('failed to load ingest log');
      return rowToIngestLog(rows[0]);
    },

    async listIngestLogs(limit = 50): Promise<IngestLog[]> {
      const n = Math.trunc(Number(limit));
      if (!Number.isFinite(n) || n < 0) throw new Error('invalid limit');
      const [rows] = await pool.execute<IngestLogRow[]>(
        `SELECT * FROM ingest_logs ORDER BY id DESC LIMIT ${n}`,
      );
      return rows.map(rowToIngestLog);
    },
  };
}
