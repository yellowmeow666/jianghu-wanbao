/**
 * Defaults while waiting on tech lead:
 * - timeline: [{ at: string, text: string }]
 * - source_platform / source_type: free strings (varchar 64)
 * - today / week scopes use Asia/Shanghai calendar days
 * - unpublish → archived; re-list via publish
 * - MySQL via DATABASE_URL (mysql://user:pass@host:port/dbname)
 */

export type CardStatus = 'draft' | 'pending' | 'published' | 'archived';

export interface TimelineItem {
  at: string;
  text: string;
}

export interface Card {
  id: number;
  title: string;
  summary: string;
  timeline: TimelineItem[];
  source_platform: string;
  source_type: string;
  clarified: boolean;
  status: CardStatus;
  created_at: string; // ISO
  updated_at: string; // ISO
}

/** C-end public shape (status included read-only). */
export interface CardPublic {
  id: number;
  title: string;
  summary: string;
  timeline: TimelineItem[];
  source_platform: string;
  source_type: string;
  clarified: boolean;
  status: CardStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateCardInput {
  title?: string;
  summary?: string;
  timeline?: TimelineItem[];
  source_platform?: string;
  source_type?: string;
  clarified?: boolean;
}

export interface PatchCardInput {
  title?: string;
  summary?: string;
  timeline?: TimelineItem[];
  source_platform?: string;
  source_type?: string;
  clarified?: boolean;
  /** draft | pending | archived only; published must use publish endpoint */
  status?: 'draft' | 'pending' | 'archived';
}

export interface ListAdminOptions {
  statuses?: CardStatus[];
  limit: number;
  offset: number;
}

export type PublicScope = 'today' | 'week';

export interface CardStore {
  create(input: CreateCardInput, now: Date): Promise<Card>;
  getById(id: number): Promise<Card | null>;
  listAdmin(opts: ListAdminOptions): Promise<Card[]>;
  listPublished(scope: PublicScope, now: Date): Promise<Card[]>;
  update(id: number, patch: PatchCardInput, now: Date): Promise<Card | null>;
  setStatus(id: number, status: CardStatus, now: Date): Promise<Card | null>;
}

export function toPublic(card: Card): CardPublic {
  return {
    id: card.id,
    title: card.title,
    summary: card.summary,
    timeline: card.timeline,
    source_platform: card.source_platform,
    source_type: card.source_type,
    clarified: card.clarified,
    status: card.status,
    created_at: card.created_at,
    updated_at: card.updated_at,
  };
}
