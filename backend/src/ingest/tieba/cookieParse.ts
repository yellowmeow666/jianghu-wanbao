/**
 * 把管理员粘贴的 Netscape cookies.txt / JSON 数组收成一条 Cookie 请求头。
 * 只保留对 tieba.baidu.com（含父域 .baidu.com）有用的条目，并拒绝能拆断请求头的字符。
 */

export class CookieParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CookieParseError';
  }
}

interface ParsedCookie {
  name: string;
  value: string;
  domain?: string;
}

const TIEBA_HOST = 'tieba.baidu.com';

/** 名称里不能有分隔符；值里不能有 CR/LF/;，避免把别的头或第二条 cookie 注进去。 */
const NAME_OK = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALUE_UNSAFE = /[\r\n;]/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function assertHeaderSafe(name: string, value: string): void {
  if (!NAME_OK.test(name) || VALUE_UNSAFE.test(value) || hasControlChar(value)) {
    throw new CookieParseError(
      'cookie name or value contains characters that cannot be sent in a Cookie header',
    );
  }
}

/**
 * 空 domain 视为「这份粘贴就是给贴吧用的」。
 * 只接受 tieba.baidu.com 自身，以及父域 baidu.com / .baidu.com。
 * 不接受 www.baidu.com、passport.baidu.com 这类兄弟域，避免把无关 cookie 带上。
 */
export function isTiebaCookieDomain(domain: string | undefined): boolean {
  if (domain === undefined || domain.trim() === '') return true;
  const host = domain.trim().toLowerCase().replace(/^\./, '');
  if (host === TIEBA_HOST || host === 'baidu.com') return true;
  if (host.endsWith('.tieba.baidu.com')) return true;
  return false;
}

function buildCookieHeader(cookies: ParsedCookie[]): string {
  // 同名以后出现的为准（更具体的覆盖前面的），Map 保留首次插入位置。
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    byName.set(cookie.name, cookie.value);
  }
  if (byName.size === 0) {
    throw new CookieParseError('no cookies applicable to tieba.baidu.com or .baidu.com');
  }
  return [...byName.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function parseNetscape(content: string): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    // HttpOnly 行以 #HttpOnly_ 开头，后面才是真正的 domain，不能当注释丢掉。
    if (line.startsWith('#HttpOnly_')) {
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const domain = parts[0]?.trim() ?? '';
    const name = parts[5]?.trim() ?? '';
    const value = parts.slice(6).join('\t').trim();
    if (!name || !value) continue;
    assertHeaderSafe(name, value);
    cookies.push({ name, value, domain });
  }
  return cookies;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJsonCookies(content: string): ParsedCookie[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw new CookieParseError('json cookie content must be a JSON array');
  }
  if (!Array.isArray(parsed)) {
    throw new CookieParseError('json cookie content must be a JSON array of {name,value}');
  }
  const cookies: ParsedCookie[] = [];
  for (const item of parsed) {
    if (!isPlainObject(item)) {
      throw new CookieParseError('json cookie content must be a JSON array of {name,value}');
    }
    if (typeof item.name !== 'string' || typeof item.value !== 'string') {
      throw new CookieParseError('cookie name and value must be strings');
    }
    const name = item.name.trim();
    const value = item.value.trim();
    if (!name || !value) {
      throw new CookieParseError('cookie name and value must be non-empty');
    }
    if (item.domain !== undefined && typeof item.domain !== 'string') {
      throw new CookieParseError('cookie domain must be a string when present');
    }
    if (item.path !== undefined && typeof item.path !== 'string') {
      throw new CookieParseError('cookie path must be a string when present');
    }
    assertHeaderSafe(name, value);
    cookies.push({
      name,
      value,
      domain: typeof item.domain === 'string' ? item.domain : undefined,
    });
  }
  return cookies;
}

/** 解析成功返回 Cookie 头的值（不含 "Cookie:" 前缀）。失败抛 CookieParseError，消息不含明文。 */
export function parseCookieContent(format: string, content: string): string {
  if (format !== 'netscape' && format !== 'json') {
    throw new CookieParseError('format must be netscape or json');
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new CookieParseError('content must be a non-empty string');
  }
  const cookies = format === 'netscape' ? parseNetscape(content) : parseJsonCookies(content);
  const useful = cookies.filter((cookie) => isTiebaCookieDomain(cookie.domain));
  return buildCookieHeader(useful);
}
