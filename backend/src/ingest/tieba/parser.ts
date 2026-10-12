import * as cheerio from 'cheerio';
import { IngestFetchError } from './fetch.js';

export interface TiebaPostParsed {
  title: string;
  body: string;
  posted_at: string;
  author: string;
  url: string;
}

export interface TiebaListItem {
  title: string;
  posted_at: string;
  url: string;
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Parse LZ (楼主) main floor from a Tieba post HTML fixture / page.
 * Selectors mirror classic PC tieba markup used in fixtures.
 */
export function parseTiebaPostHtml(html: string, canonicalUrl: string): TiebaPostParsed {
  const $ = cheerio.load(html);

  const pageText = $.root().text();
  if (
    pageText.includes('该贴已被删除') ||
    pageText.includes('帖子不存在') ||
    pageText.includes('贴子不存在')
  ) {
    throw new IngestFetchError('NOT_FOUND', 'post not found or deleted');
  }

  let title =
    cleanText($('h3.core_title_txt').first().text()) ||
    cleanText($('.core_title_txt').first().text()) ||
    cleanText($('h1').first().text()) ||
    '';
  if (!title) {
    const t = $('title').first().text().trim();
    title = t.replace(/_.*百度贴吧.*$/, '').replace(/【.*?】/g, '').trim();
  }
  if (!title) {
    throw new IngestFetchError('FETCH_FAILED', 'failed to parse post title');
  }

  const firstFloor = $('.l_post').first();
  const author =
    cleanText(firstFloor.find('.p_author_name').first().text()) ||
    cleanText(firstFloor.find('.d_name a').first().text()) ||
    cleanText($('.p_author_name').first().text()) ||
    'unknown';

  const bodyEl = firstFloor.find('.d_post_content').first().length
    ? firstFloor.find('.d_post_content').first()
    : $('.d_post_content').first();
  const body = cleanText(bodyEl.text());
  if (!body) {
    throw new IngestFetchError('FETCH_FAILED', 'failed to parse post body');
  }

  let posted_at = '';
  const dataField = firstFloor.attr('data-field') || $('.l_post').first().attr('data-field');
  if (dataField) {
    try {
      const parsed = JSON.parse(dataField) as {
        content?: { date?: string };
      };
      if (parsed.content?.date) posted_at = parsed.content.date;
    } catch {
      /* ignore */
    }
  }
  if (!posted_at) {
    firstFloor.find('.post-tail-wrap .tail-info, .p_tail li, .tail-info').each((_, el) => {
      const t = $(el).text().trim();
      if (/\d{4}-\d{2}-\d{2}/.test(t)) {
        posted_at = t;
        return false;
      }
      return undefined;
    });
  }
  if (!posted_at) posted_at = 'unknown';

  return { title, body, posted_at, author, url: canonicalUrl };
}

/** Parse thread list items from a Tieba forum (吧) list HTML. */
export function parseTiebaListHtml(html: string): TiebaListItem[] {
  const $ = cheerio.load(html);
  const items: TiebaListItem[] = [];
  const seen = new Set<string>();

  $('li.j_thread_list, .j_thread_list').each((_, el) => {
    const row = $(el);
    const a = row.find('a.j_th_tit').first();
    const href = a.attr('href') || '';
    const title = cleanText(a.text());
    const m = /\/p\/(\d+)/.exec(href);
    if (!m || !title) return;
    const url = `https://tieba.baidu.com/p/${m[1]}`;
    if (seen.has(url)) return;
    seen.add(url);

    let posted_at = '';
    const dataField = row.attr('data-field');
    if (dataField) {
      try {
        const parsed = JSON.parse(dataField) as {
          last_post_at?: string;
          create_time?: number | string;
        };
        if (typeof parsed.create_time === 'number') {
          posted_at = formatShanghai(new Date(parsed.create_time * 1000));
        } else if (typeof parsed.create_time === 'string' && parsed.create_time) {
          posted_at = parsed.create_time;
        } else if (parsed.last_post_at) {
          posted_at = parsed.last_post_at;
        }
      } catch {
        /* ignore */
      }
    }
    if (!posted_at) {
      posted_at =
        cleanText(row.find('.is_show_create_time, .threadlist_reply_date').first().text()) ||
        'unknown';
    }

    items.push({ title, posted_at, url });
  });

  if (items.length === 0) {
    $('a[href*="/p/"]').each((_, el) => {
      const a = $(el);
      const href = a.attr('href') || '';
      const m = /\/p\/(\d+)/.exec(href);
      const title = cleanText(a.text());
      if (!m || !title || title.length < 2) return;
      const url = `https://tieba.baidu.com/p/${m[1]}`;
      if (seen.has(url)) return;
      seen.add(url);
      items.push({ title, posted_at: 'unknown', url });
    });
  }

  return items;
}

function formatShanghai(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Parse a free-form posted_at string into Date for window filter.
 * Accepts "YYYY-MM-DD HH:mm:ss", ISO, or date-only (Asia/Shanghai).
 */
export function parsePostedAt(raw: string): Date | null {
  if (!raw || raw === 'unknown') return null;
  const trimmed = raw.trim();
  if (/T|Z|\+/.test(trimmed)) {
    const isoTry = Date.parse(trimmed);
    if (!Number.isNaN(isoTry)) return new Date(isoTry);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`);
  }
  const n = Date.parse(trimmed);
  if (!Number.isNaN(n)) return new Date(n);
  return null;
}
