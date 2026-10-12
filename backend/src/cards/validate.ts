import type { Card, CreateCardInput, PatchCardInput, TimelineItem } from './types.js';

const TITLE_MAX = 200;
const SUMMARY_MAX = 500;
const SOURCE_MAX = 64;
const TIMELINE_TEXT_MAX = 500;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseTimeline(raw: unknown): TimelineItem[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('timeline must be an array of {at, text}');
  }
  return raw.map((item, i) => {
    if (!isPlainObject(item)) {
      throw new ValidationError(`timeline[${i}] must be an object`);
    }
    const at = item.at;
    const text = item.text;
    if (typeof at !== 'string') {
      throw new ValidationError(`timeline[${i}].at must be a string`);
    }
    if (typeof text !== 'string') {
      throw new ValidationError(`timeline[${i}].text must be a string`);
    }
    if (text.length > TIMELINE_TEXT_MAX) {
      throw new ValidationError(
        `timeline[${i}].text must be at most ${TIMELINE_TEXT_MAX} characters`,
      );
    }
    return { at, text };
  });
}

function optString(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  if (v.length > max) {
    throw new ValidationError(`${field} must be at most ${max} characters`);
  }
  return v;
}

function optBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return v;
}

/** POST /api/admin/cards — draft; title/summary may be ""; timeline may be []. */
export function parseCreateBody(body: unknown): CreateCardInput {
  if (body === undefined || body === null) return {};
  if (!isPlainObject(body)) {
    throw new ValidationError('body must be a JSON object');
  }
  const input: CreateCardInput = {};
  if ('title' in body) input.title = optString(body.title, 'title', TITLE_MAX) ?? '';
  if ('summary' in body) input.summary = optString(body.summary, 'summary', SUMMARY_MAX) ?? '';
  if ('timeline' in body) input.timeline = parseTimeline(body.timeline);
  if ('source_platform' in body) {
    input.source_platform = optString(body.source_platform, 'source_platform', SOURCE_MAX) ?? '';
  }
  if ('source_type' in body) {
    input.source_type = optString(body.source_type, 'source_type', SOURCE_MAX) ?? '';
  }
  if ('clarified' in body) input.clarified = optBool(body.clarified, 'clarified') ?? false;
  return input;
}

/**
 * PATCH — content fields + status draft|pending|archived.
 * status=published → INVALID_BODY tip to use publish endpoint.
 */
export function parsePatchBody(body: unknown): PatchCardInput {
  if (!isPlainObject(body)) {
    throw new ValidationError('body must be a JSON object');
  }
  const patch: PatchCardInput = {};
  if ('title' in body) patch.title = optString(body.title, 'title', TITLE_MAX) ?? '';
  if ('summary' in body) patch.summary = optString(body.summary, 'summary', SUMMARY_MAX) ?? '';
  if ('timeline' in body) patch.timeline = parseTimeline(body.timeline);
  if ('source_platform' in body) {
    patch.source_platform = optString(body.source_platform, 'source_platform', SOURCE_MAX) ?? '';
  }
  if ('source_type' in body) {
    patch.source_type = optString(body.source_type, 'source_type', SOURCE_MAX) ?? '';
  }
  if ('clarified' in body) patch.clarified = optBool(body.clarified, 'clarified') ?? false;
  if ('status' in body) {
    const s = body.status;
    if (s === 'published') {
      throw new ValidationError('use POST /api/admin/cards/:id/publish to set status=published');
    }
    if (s !== 'draft' && s !== 'pending' && s !== 'archived') {
      throw new ValidationError('status must be draft, pending, or archived');
    }
    patch.status = s;
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('at least one field is required');
  }
  return patch;
}

/** Publish validation: title/summary non-empty trim; timeline ≥1 with non-empty text; sources non-empty. */
export function assertPublishable(card: Card): void {
  if (!card.title.trim()) {
    throw new ValidationError('title must be non-empty to publish');
  }
  if (!card.summary.trim()) {
    throw new ValidationError('summary must be non-empty to publish');
  }
  if (!Array.isArray(card.timeline) || card.timeline.length < 1) {
    throw new ValidationError('timeline must have at least one item to publish');
  }
  for (let i = 0; i < card.timeline.length; i++) {
    const t = card.timeline[i];
    if (!t.text.trim()) {
      throw new ValidationError(`timeline[${i}].text must be non-empty to publish`);
    }
    if (t.text.length > TIMELINE_TEXT_MAX) {
      throw new ValidationError(
        `timeline[${i}].text must be at most ${TIMELINE_TEXT_MAX} characters`,
      );
    }
  }
  if (!card.source_platform.trim()) {
    throw new ValidationError('source_platform must be non-empty to publish');
  }
  if (!card.source_type.trim()) {
    throw new ValidationError('source_type must be non-empty to publish');
  }
}

export function parseIdParam(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError('id must be a positive integer');
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ValidationError('id must be a positive integer');
  }
  return n;
}

export function parseAdminListQuery(query: Record<string, unknown>): {
  statuses?: import('./types.js').CardStatus[];
  limit: number;
  offset: number;
} {
  let limit = 50;
  let offset = 0;
  if (query.limit !== undefined && query.limit !== '') {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new ValidationError('limit must be a positive integer');
    }
    if (n > 100) {
      throw new ValidationError('limit must be at most 100');
    }
    limit = n;
  }
  if (query.offset !== undefined && query.offset !== '') {
    const n = Number(query.offset);
    if (!Number.isInteger(n) || n < 0) {
      throw new ValidationError('offset must be a non-negative integer');
    }
    offset = n;
  }
  let statuses: import('./types.js').CardStatus[] | undefined;
  if (query.status !== undefined && query.status !== '') {
    if (typeof query.status !== 'string') {
      throw new ValidationError('status must be a comma-separated string');
    }
    const allowed = new Set(['draft', 'pending', 'published', 'archived']);
    const parts = query.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      throw new ValidationError('status must list at least one value');
    }
    for (const p of parts) {
      if (!allowed.has(p)) {
        throw new ValidationError(
          `status value must be draft, pending, published, or archived (got ${p})`,
        );
      }
    }
    statuses = parts as import('./types.js').CardStatus[];
  }
  return { statuses, limit, offset };
}

export function parsePublicScope(raw: unknown): 'today' | 'week' {
  if (raw !== 'today' && raw !== 'week') {
    throw new ValidationError('scope must be today or week');
  }
  return raw;
}
