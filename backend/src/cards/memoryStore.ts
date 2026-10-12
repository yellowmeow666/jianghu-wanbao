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
} from './types.js';
import { publishedRange, toIso } from './time.js';

/** In-memory CardStore for unit/API tests (no MySQL). */
export function createMemoryStore(): CardStore {
  const cards = new Map<number, Card>();
  const bySourceUrl = new Map<string, number>();
  const ingestLogs: IngestLog[] = [];
  let seq = 1;
  let logSeq = 1;

  return {
    async create(input: CreateCardInput, now: Date): Promise<Card> {
      const source_url =
        input.source_url === undefined || input.source_url === null || input.source_url === ''
          ? null
          : input.source_url;
      if (source_url && bySourceUrl.has(source_url)) {
        const err = new Error('source_url already exists') as Error & { code: string };
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const iso = toIso(now);
      const card: Card = {
        id: seq++,
        title: input.title ?? '',
        summary: input.summary ?? '',
        timeline: input.timeline ? structuredClone(input.timeline) : [],
        source_platform: input.source_platform ?? '',
        source_type: input.source_type ?? '',
        clarified: input.clarified ?? false,
        status: 'draft',
        source_url,
        created_at: iso,
        updated_at: iso,
      };
      cards.set(card.id, card);
      if (source_url) bySourceUrl.set(source_url, card.id);
      return structuredClone(card);
    },

    async getById(id: number): Promise<Card | null> {
      const c = cards.get(id);
      return c ? structuredClone(c) : null;
    },

    async getBySourceUrl(url: string): Promise<Card | null> {
      const id = bySourceUrl.get(url);
      if (id === undefined) return null;
      return this.getById(id);
    },

    async listAdmin(opts: ListAdminOptions): Promise<Card[]> {
      let list = [...cards.values()];
      if (opts.statuses && opts.statuses.length > 0) {
        const set = new Set(opts.statuses);
        list = list.filter((c) => set.has(c.status));
      }
      list.sort((a, b) => {
        const t = b.updated_at.localeCompare(a.updated_at);
        return t !== 0 ? t : b.id - a.id;
      });
      return list.slice(opts.offset, opts.offset + opts.limit).map((c) => structuredClone(c));
    },

    async listPublished(scope: PublicScope, now: Date): Promise<Card[]> {
      const { from, toExclusive } = publishedRange(scope, now);
      const fromMs = from.getTime();
      const toMs = toExclusive.getTime();
      const list = [...cards.values()].filter((c) => {
        if (c.status !== 'published') return false;
        const t = new Date(c.updated_at).getTime();
        return t >= fromMs && t < toMs;
      });
      list.sort((a, b) => {
        const t = b.updated_at.localeCompare(a.updated_at);
        return t !== 0 ? t : b.id - a.id;
      });
      return list.map((c) => structuredClone(c));
    },

    async update(id: number, patch: PatchCardInput, now: Date): Promise<Card | null> {
      const c = cards.get(id);
      if (!c) return null;
      if (patch.title !== undefined) c.title = patch.title;
      if (patch.summary !== undefined) c.summary = patch.summary;
      if (patch.timeline !== undefined) c.timeline = structuredClone(patch.timeline);
      if (patch.source_platform !== undefined) c.source_platform = patch.source_platform;
      if (patch.source_type !== undefined) c.source_type = patch.source_type;
      if (patch.clarified !== undefined) c.clarified = patch.clarified;
      if (patch.status !== undefined) c.status = patch.status;
      c.updated_at = toIso(now);
      return structuredClone(c);
    },

    async setStatus(id: number, status: CardStatus, now: Date): Promise<Card | null> {
      const c = cards.get(id);
      if (!c) return null;
      c.status = status;
      c.updated_at = toIso(now);
      return structuredClone(c);
    },

    async appendIngestLog(input: IngestLogInput, now: Date): Promise<IngestLog> {
      const log: IngestLog = {
        id: logSeq++,
        actor: input.actor,
        action: input.action,
        target: input.target,
        meta: input.meta ? structuredClone(input.meta) : null,
        created_at: toIso(now),
      };
      ingestLogs.push(log);
      return structuredClone(log);
    },

    async listIngestLogs(limit = 50): Promise<IngestLog[]> {
      const n = Math.max(0, Math.trunc(limit));
      return ingestLogs.slice(-n).reverse().map((l) => structuredClone(l));
    },
  };
}
