import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTiebaListHtml, parseTiebaPostHtml } from '../src/ingest/tieba/parser.js';
import { detectPageBlock } from '../src/ingest/tieba/fetch.js';
import { normalizeTiebaPostUrl } from '../src/ingest/tieba/url.js';
import { classifySourceType, score818, truncateSummary } from '../src/ingest/score.js';

const fix = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tieba');

function read(name: string): string {
  return fs.readFileSync(path.join(fix, name), 'utf8');
}

describe('normalizeTiebaPostUrl', () => {
  it('normalizes https and strips query', () => {
    expect(normalizeTiebaPostUrl('http://tieba.baidu.com/p/12345?see_lz=1&pn=2')).toBe(
      'https://tieba.baidu.com/p/12345',
    );
  });

  it('rejects non-post urls', () => {
    expect(() => normalizeTiebaPostUrl('https://tieba.baidu.com/f?kw=x')).toThrow(/match/);
    expect(() => normalizeTiebaPostUrl('https://example.com/p/1')).toThrow(/tieba/);
  });
});

describe('parseTiebaPostHtml (fixtures only)', () => {
  it('parses normal post LZ fields', () => {
    const html = read('post-ok.html');
    const p = parseTiebaPostHtml(html, 'https://tieba.baidu.com/p/999');
    expect(p.title).toContain('实锤');
    expect(p.author).toBe('吃瓜路人甲');
    expect(p.posted_at).toMatch(/2026-10-11/);
    expect(p.body).toContain('开盒锤爆');
    expect(p.body).not.toContain('二楼回复');
    expect(p.url).toBe('https://tieba.baidu.com/p/999');
  });

  it('detects 404/deleted page', () => {
    const html = read('post-404.html');
    expect(detectPageBlock(200, html)).toBe('NOT_FOUND');
    expect(detectPageBlock(404, html)).toBe('NOT_FOUND');
  });

  it('detects captcha wall', () => {
    const html = read('post-captcha.html');
    expect(detectPageBlock(200, html)).toBe('CAPTCHA');
  });
});

describe('parseTiebaListHtml', () => {
  it('extracts titles and urls', () => {
    const items = parseTiebaListHtml(read('list-ok.html'));
    expect(items.length).toBe(4);
    expect(items[0].url).toBe('https://tieba.baidu.com/p/111');
    expect(items[2].title).toContain('实锤');
  });
});

describe('score818 & classifySourceType', () => {
  it('scores gossip keywords', () => {
    const r = score818('实锤塌房大瓜');
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons).toEqual(expect.arrayContaining(['实锤', '塌房', '瓜']));
  });

  it('classifies source_type', () => {
    expect(classifySourceType('开盒曝光住址')).toBe('doxxing');
    expect(classifySourceType('实锤锤爆')).toBe('evidence');
    expect(classifySourceType('普通攻略')).toBe('other');
  });

  it('truncates summary to 200', () => {
    const s = truncateSummary('字'.repeat(250), 200);
    expect(s.length).toBe(200);
  });
});
