import { ValidationError } from '../../cards/validate.js';

const POST_HOST = 'tieba.baidu.com';
const POST_PATH = /^\/p\/(\d+)\/?$/;

/**
 * Validate & normalize a Baidu Tieba post URL.
 * - host must be tieba.baidu.com
 * - path /p/{digits}
 * - strip query/hash; force https
 */
export function normalizeTiebaPostUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('url must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ValidationError('url must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('url must be http(s)');
  }
  if (parsed.hostname.toLowerCase() !== POST_HOST) {
    throw new ValidationError('url must be a tieba.baidu.com post link');
  }
  const m = POST_PATH.exec(parsed.pathname);
  if (!m) {
    throw new ValidationError('url must match tieba.baidu.com/p/{id}');
  }
  return `https://${POST_HOST}/p/${m[1]}`;
}

export function tiebaListUrl(bar: string, pn = 1): string {
  const kw = encodeURIComponent(bar);
  const page = pn > 1 ? `&pn=${(pn - 1) * 50}` : '';
  return `https://tieba.baidu.com/f?kw=${kw}&ie=utf-8${page}`;
}
