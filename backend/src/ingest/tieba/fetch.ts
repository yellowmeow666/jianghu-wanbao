import type { ErrorCode } from '../../errors.js';

export const TIEBA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FetchResult {
  status: number;
  body: string;
  url: string;
}

/** 可选请求头。采集在已配置 Cookie 时只多传 Cookie，测试里的假 fetcher 可以忽略第二个参数。 */
export interface FetchInit {
  headers?: Record<string, string>;
}

export type PageFetcher = (url: string, init?: FetchInit) => Promise<FetchResult>;

export class IngestFetchError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'IngestFetchError';
    this.code = code;
  }
}

const CAPTCHA_MARKERS = [
  '验证码',
  '安全验证',
  'wappolice',
  'passport.baidu.com',
  '请登录',
  'login-form',
  'captcha',
];

const DELETED_MARKERS = [
  '该贴已被删除',
  '贴子不存在',
  '帖子不存在',
  '本吧目前没有此贴',
  '抱歉，您访问的贴子不存在',
  'error_404',
];

const BLOCK_MESSAGE: Partial<Record<ErrorCode, string>> = {
  NOT_FOUND: 'post not found or deleted',
  CAPTCHA: 'captcha or login wall detected',
  FETCH_FAILED: 'failed to fetch remote page',
};

export function detectPageBlock(status: number, body: string): ErrorCode | null {
  if (status === 404) return 'NOT_FOUND';
  if (status === 403) {
    const lower = body.toLowerCase();
    if (CAPTCHA_MARKERS.some((m) => body.includes(m) || lower.includes(m.toLowerCase()))) {
      return 'CAPTCHA';
    }
    return 'FETCH_FAILED';
  }
  if (status !== 200) return 'FETCH_FAILED';
  if (DELETED_MARKERS.some((m) => body.includes(m))) return 'NOT_FOUND';
  if (CAPTCHA_MARKERS.some((m) => body.includes(m))) {
    const hasPost = body.includes('d_post_content') || body.includes('core_title');
    if (!hasPost) return 'CAPTCHA';
  }
  return null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Real network fetcher (not used in CI/unit tests). */
export function createHttpFetcher(timeoutMs = DEFAULT_TIMEOUT_MS): PageFetcher {
  return async (url: string, init?: FetchInit): Promise<FetchResult> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // 默认头始终带上；仅当调用方传入 Cookie 时才附加，未配置时请求与以前一致。
      const headers: Record<string, string> = {
        'User-Agent': TIEBA_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      };
      if (init?.headers) {
        for (const [name, value] of Object.entries(init.headers)) {
          if (value) headers[name] = value;
        }
      }
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac.signal,
        headers,
      });
      const body = await res.text();
      return { status: res.status, body, url: res.url || url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new IngestFetchError('FETCH_FAILED', `fetch timeout or network error: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function fetchTiebaPage(
  fetcher: PageFetcher,
  url: string,
  init?: FetchInit,
): Promise<FetchResult> {
  let result: FetchResult;
  try {
    result = await fetcher(url, init);
  } catch (err) {
    if (err instanceof IngestFetchError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new IngestFetchError('FETCH_FAILED', msg);
  }
  const block = detectPageBlock(result.status, result.body);
  if (block) {
    throw new IngestFetchError(block, BLOCK_MESSAGE[block] ?? block);
  }
  return result;
}
