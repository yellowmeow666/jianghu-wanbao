import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from './errors'
import { collectPublishedCards, readPublishedCard } from './normalize'

const published = {
  id: 'c1',
  title: '茶馆传闻',
  summary: '摘要',
  timeline: [{ at: '2026-10-12T01:00:00.000Z', text: '有人转述' }],
  source_platform: '论坛',
  source_type: '帖子',
  clarified: false,
  status: 'published',
  created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T02:00:00.000Z',
}

describe('collectPublishedCards', () => {
  it('只接受契约里的 items 列表', () => {
    assert.equal(collectPublishedCards({ items: [published] }).length, 1)
    assert.equal(collectPublishedCards({ items: [published] })[0].source_platform, '论坛')
  })

  it('空 items 是空态，不是错误', () => {
    assert.deepEqual(collectPublishedCards({ items: [] }), [])
  })

  it('未发布条目不能混进 C 端列表', () => {
    assert.throws(
      () => collectPublishedCards({ items: [{ ...published, status: 'draft' }] }),
      (error: unknown) => error instanceof ApiError && error.code === 'not_published',
    )
  })

  it('缺少 items 时不伪装成空列表', () => {
    assert.throws(
      () => collectPublishedCards([published]),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_response',
    )
  })

  it('camelCase 同义字段仍能读出，缺省 status 则视为无法识别', () => {
    const cards = collectPublishedCards({
      items: [{
        id: 'c2',
        title: '另一条',
        summary: '',
        timeline: [],
        sourcePlatform: '微博',
        sourceType: '转发',
        clarified: true,
        status: 'published',
        updatedAt: '2026-10-12T03:00:00.000Z',
        createdAt: '2026-10-11T03:00:00.000Z',
      }],
    })
    assert.equal(cards[0].source_platform, '微博')
    assert.equal(cards[0].clarified, true)
    assert.equal(cards[0].updated_at, '2026-10-12T03:00:00.000Z')
  })
})

describe('readPublishedCard', () => {
  it('详情体就是 Card，并拒绝未发布', () => {
    assert.equal(readPublishedCard(published).title, '茶馆传闻')
    assert.throws(
      () => readPublishedCard({ ...published, status: 'archived' }),
      (error: unknown) => error instanceof ApiError && error.code === 'not_published',
    )
  })
})
