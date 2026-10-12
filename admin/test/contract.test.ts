import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyForm, isoToLocalInput, localInputToIso, publishIssues, saveIssues } from '../src/form.ts'
import { ApiError, parseErrorBody, readCard, readCardList } from '../src/model.ts'

const card = {
  id: 'c1',
  title: '茶馆传闻',
  summary: '摘要',
  timeline: [{ at: '2026-10-12T00:00:00.000Z', text: '有人转述' }],
  source_platform: '论坛',
  source_type: '帖子',
  clarified: false,
  status: 'draft',
  created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T01:00:00.000Z',
}

describe('管理端响应', () => {
  it('列表只认 items，空列表不是错误', () => {
    assert.equal(readCardList({ items: [card] })[0].title, '茶馆传闻')
    assert.deepEqual(readCardList({ items: [] }), [])
    assert.throws(
      () => readCardList([card]),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_response',
    )
  })

  it('草稿允许空标题', () => {
    const draft = readCard({ ...card, title: '', summary: '', timeline: [] })
    assert.equal(draft.title, '')
    assert.equal(draft.status, 'draft')
  })

  it('错误体按契约读取', () => {
    const error = parseErrorBody({ error: { code: 'UNAUTHORIZED', message: 'bad token' } }, 401)
    assert.equal(error.code, 'UNAUTHORIZED')
    assert.equal(error.message, 'bad token')
  })
})

describe('发布校验', () => {
  it('空草稿可以保存，但不能发布', () => {
    const form = emptyForm()
    assert.deepEqual(saveIssues(form), [])
    assert.ok(publishIssues(form).length >= 4)
  })

  it('时间控件往返后仍能被 Date 解析', () => {
    const iso = localInputToIso('2026-10-12T08:30')
    assert.equal(Number.isNaN(new Date(iso).getTime()), false)
    assert.equal(isoToLocalInput(iso), '2026-10-12T08:30')
  })
})
