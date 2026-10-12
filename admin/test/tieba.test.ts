import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError, parseErrorBody } from '../src/model.ts'
import {
  explainIngestError,
  formatShanghaiOffset,
  localInputToShanghaiIso,
  localTiebaUrlIssue,
  readCandidates,
} from '../src/tieba.ts'

describe('贴吧错误', () => {
  it('ALREADY_EXISTS 读出同级 card_id', () => {
    const error = parseErrorBody({
      error: { code: 'ALREADY_EXISTS', message: 'duplicate thread' },
      card_id: 42,
    }, 409)
    assert.equal(error.code, 'ALREADY_EXISTS')
    assert.equal(error.cardId, '42')
    assert.match(explainIngestError(error), /已经入库/)
    assert.match(explainIngestError(error), /duplicate thread/)
  })

  it('验证码、限流，以及后端用 INVALID_BODY 表示的非法链接，都有人话', () => {
    const captcha = new ApiError('captcha or login wall detected', 'CAPTCHA', 403)
    const limited = new ApiError('too many ingest requests', 'RATE_LIMITED', 429)
    const badUrl = new ApiError('url must be a tieba.baidu.com post link', 'INVALID_BODY', 400)
    assert.match(explainIngestError(captcha), /验证/)
    assert.match(explainIngestError(limited), /太频繁/)
    assert.match(explainIngestError(badUrl), /贴吧帖子/)
    assert.equal(localTiebaUrlIssue('https://tieba.baidu.com/p/999001?see_lz=1'), null)
    assert.match(localTiebaUrlIssue('https://example.com/p/1') ?? '', /贴吧帖子地址/)
  })
})

describe('贴吧扫描', () => {
  it('只认 candidates，并保留分数和理由', () => {
    const rows = readCandidates({
      candidates: [{
        title: '茶馆传闻',
        posted_at: '2026-10-12T08:00:00+08:00',
        url: 'https://tieba.baidu.com/p/1',
        score: 3,
        reasons: ['标题命中', '时间接近'],
      }],
    })
    assert.equal(rows[0].title, '茶馆传闻')
    assert.equal(rows[0].score, 3)
    assert.deepEqual(rows[0].reasons, ['标题命中', '时间接近'])
  })

  it('空候选是空表，缺 candidates 不是', () => {
    assert.deepEqual(readCandidates({ candidates: [] }), [])
    assert.throws(
      () => readCandidates({ items: [] }),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_response',
    )
  })

  it('时间控件按上海墙钟加上 +08:00，不改钟点', () => {
    assert.equal(localInputToShanghaiIso('2026-10-12T08:30'), '2026-10-12T08:30:00+08:00')
    assert.equal(formatShanghaiOffset(new Date('2026-10-12T00:30:00Z')), '2026-10-12T08:30:00+08:00')
  })
})
