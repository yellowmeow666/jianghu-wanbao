/**
 * Asia/Shanghai (+08) calendar-day helpers for today / week scopes.
 * Prefer app-side bounds so fake store and MySQL agree without CONVERT_TZ.
 */

const TZ = 'Asia/Shanghai';

/** YYYY-MM-DD in Asia/Shanghai for the given instant. */
export function shanghaiYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Start of Shanghai calendar day as UTC Date (00:00:00.000+08:00). */
export function shanghaiDayStartUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+08:00`);
}

/** Exclusive end = start of next Shanghai calendar day. */
export function shanghaiDayEndExclusiveUtc(ymd: string): Date {
  const start = shanghaiDayStartUtc(ymd);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Add (or subtract) calendar days to a YYYY-MM-DD string (naive local). */
export function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * today: [start of Shanghai today, start of tomorrow)
 * week: [start of (today - 6 days), start of tomorrow) — 7 calendar days inclusive
 */
export function publishedRange(scope: 'today' | 'week', now: Date): { from: Date; toExclusive: Date } {
  const todayYmd = shanghaiYmd(now);
  const toExclusive = shanghaiDayEndExclusiveUtc(todayYmd);
  if (scope === 'today') {
    return { from: shanghaiDayStartUtc(todayYmd), toExclusive };
  }
  const fromYmd = addYmdDays(todayYmd, -6);
  return { from: shanghaiDayStartUtc(fromYmd), toExclusive };
}

export function toIso(d: Date): string {
  return d.toISOString();
}
