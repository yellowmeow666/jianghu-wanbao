import type { Card, CardScope } from '../types/card'
import { ApiError } from '../utils/errors'
import { collectPublishedCards, readPublishedCard } from '../utils/normalize'
import { request } from './http'

/**
 * 今日 / 本周已发布列表。
 * 窗口由服务端按 Asia/Shanghai 的自然日解释 updated_at，客户端不再筛一遍。
 */
export async function listPublishedCards(scope: CardScope): Promise<Card[]> {
  if (scope !== 'today' && scope !== 'week') {
    throw new ApiError('不支持的列表范围', 'invalid_scope', 0)
  }
  const body = await request<unknown>(`/api/cards?scope=${scope}`)
  return collectPublishedCards(body)
}

/** 详情只读已发布条目。草稿、待审、已下架都不会当成可展示内容。 */
export async function getPublishedCard(id: string): Promise<Card> {
  const trimmed = id.trim()
  if (!trimmed) {
    throw new ApiError('缺少条目编号', 'invalid_id', 0)
  }
  const body = await request<unknown>(`/api/cards/${encodeURIComponent(trimmed)}`)
  return readPublishedCard(body)
}
