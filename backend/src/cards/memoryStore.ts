import type {
  Card,
  CardStatus,
  CardStore,
  CreateCardInput,
  ListAdminOptions,
  PatchCardInput,
  PublicScope,
} from './types.js';
import { publishedRange, toIso } from './time.js';

/** In-memory CardStore for unit/API tests (no MySQL). */
export function createMemoryStore(): CardStore {
  const cards = new Map<number, Card>();
  let seq = 1;

  return {
    async create(input: CreateCardInput, now: Date): Promise<Card> {
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
        created_at: iso,
        updated_at: iso,
      };
      cards.set(card.id, card);
      return structuredClone(card);
    },

    async getById(id: number): Promise<Card | null> {
      const c = cards.get(id);
      return c ? structuredClone(c) : null;
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
  };
}
