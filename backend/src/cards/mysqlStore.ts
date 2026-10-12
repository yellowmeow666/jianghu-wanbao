import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type {
  Card,
  CardStatus,
  CardStore,
  CreateCardInput,
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
  created_at: Date | string;
  updated_at: Date | string;
}

function parseTimelineField(raw: TimelineItem[] | string): TimelineItem[] {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as TimelineItem[];
  }
  return raw ?? [];
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
    created_at: created,
    updated_at: updated,
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
      const iso = toIso(now);
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO cards
          (title, summary, timeline, source_platform, source_type, clarified, status, created_at, updated_at)
         VALUES (?, ?, CAST(? AS JSON), ?, ?, ?, 'draft', ?, ?)`,
        [
          title,
          summary,
          JSON.stringify(timeline),
          source_platform,
          source_type,
          clarified ? 1 : 0,
          iso.slice(0, 23).replace('T', ' '),
          iso.slice(0, 23).replace('T', ' '),
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

    async listAdmin(opts: ListAdminOptions): Promise<Card[]> {
      const params: unknown[] = [];
      let sql = 'SELECT * FROM cards';
      if (opts.statuses && opts.statuses.length > 0) {
        const placeholders = opts.statuses.map(() => '?').join(',');
        sql += ` WHERE status IN (${placeholders})`;
        params.push(...opts.statuses);
      }
      sql += ' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?';
      params.push(opts.limit, opts.offset);
      const [rows] = await pool.execute<CardRow[]>(sql, params);
      return rows.map(rowToCard);
    },

    async listPublished(scope: PublicScope, now: Date): Promise<Card[]> {
      const { from, toExclusive } = publishedRange(scope, now);
      const fromSql = toIso(from).slice(0, 23).replace('T', ' ');
      const toSql = toIso(toExclusive).slice(0, 23).replace('T', ' ');
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
          iso.slice(0, 23).replace('T', ' '),
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
        iso.slice(0, 23).replace('T', ' '),
        id,
      ]);
      return this.getById(id);
    },
  };
}
