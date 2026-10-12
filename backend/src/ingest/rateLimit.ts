/** Simple sliding-window rate limiter keyed by actor fingerprint. */

export interface RateLimiter {
  /** Returns true if allowed and consumes one slot; false if over limit. */
  tryTake(key: string, now?: Date): boolean;
  reset(): void;
}

export function createRateLimiter(limitPerMinute: number): RateLimiter {
  const windowMs = 60_000;
  const hits = new Map<string, number[]>();

  return {
    tryTake(key: string, now: Date = new Date()): boolean {
      const t = now.getTime();
      const cutoff = t - windowMs;
      let arr = hits.get(key) ?? [];
      arr = arr.filter((x) => x > cutoff);
      if (arr.length >= limitPerMinute) {
        hits.set(key, arr);
        return false;
      }
      arr.push(t);
      hits.set(key, arr);
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

export function parseIngestRateLimit(envVal: string | undefined, fallback = 10): number {
  if (envVal === undefined || envVal === '') return fallback;
  const n = Number(envVal);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

/** First 8 hex chars of a trivial fingerprint (not cryptographic). */
export function tokenFingerprint(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, 8);
}
