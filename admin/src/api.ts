import { readCard, readCardList, ApiError, parseErrorBody } from './model.ts'
import { readSettings } from './settings.ts'
import { readCandidates, TIEBA_BY_URL_PATH, TIEBA_IMPORT_PATH, TIEBA_SCAN_PATH, type TiebaCandidate, type TiebaScanInput } from './tieba.ts'
import type { Card, CardInput, CardPatch, CardStatus } from './types.ts'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
}

/**
 * 管理端每个请求都带 X-Admin-Token。
 * 令牌为空也发送该头，让服务端按契约返回 UNAUTHORIZED，而不是客户端悄悄省略。
 */
export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const settings = readSettings()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Admin-Token': settings.adminToken,
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`${settings.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(
      '无法连接整理服务。请确认 API 地址，以及后端是否已启动。',
      'network_error',
      0,
    )
  }

  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text
    }
  }

  if (!response.ok) {
    throw parseErrorBody(body, response.status)
  }
  return body
}

export interface ListQuery {
  status?: CardStatus | ''
  limit?: number
  offset?: number
}

export async function listCards(query: ListQuery = {}): Promise<Card[]> {
  const params = new URLSearchParams()
  params.set('limit', String(query.limit ?? 50))
  params.set('offset', String(query.offset ?? 0))
  // 省略 status 表示不过滤。空字符串不要传，否则服务端可能判 INVALID_BODY。
  if (query.status) params.set('status', query.status)
  const body = await request(`/api/admin/cards?${params.toString()}`)
  return readCardList(body)
}

/** 创建出来的状态固定是 draft，请求体里不写 status。 */
export async function createCard(input: CardInput): Promise<Card> {
  const body = await request('/api/admin/cards', { method: 'POST', body: input })
  return readCard(body)
}

export async function updateCard(id: string, patch: CardPatch): Promise<Card> {
  const body = await request(`/api/admin/cards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  })
  return readCard(body)
}

export async function publishCard(id: string): Promise<Card> {
  const body = await request(`/api/admin/cards/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  })
  return readCard(body)
}

export async function unpublishCard(id: string): Promise<Card> {
  const body = await request(`/api/admin/cards/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
  })
  return readCard(body)
}

/** 管理端没有按 id 取单条的接口。ALREADY_EXISTS 只给 card_id，所以翻列表找已有草稿。 */
export async function getAdminCardById(id: string): Promise<Card> {
  const target = id.trim()
  let offset = 0
  const limit = 50
  for (let page = 0; page < 20; page += 1) {
    const items = await listCards({ limit, offset })
    const found = items.find((card) => card.id === target)
    if (found) return found
    if (items.length < limit) break
    offset += items.length
  }
  throw new ApiError(`列表里没有编号 ${target} 的条目`, 'NOT_FOUND', 404)
}

/** 按帖子链接抓楼主主楼，成功时返回草稿 Card。 */
export async function ingestTiebaByUrl(url: string): Promise<Card> {
  const body = await request(TIEBA_BY_URL_PATH, { method: 'POST', body: { url } })
  return readCard(body)
}

/** 只拉候选，不入库。吧名留空时不传 bar，让服务端用自己的默认值。 */
export async function scanTieba(input: TiebaScanInput): Promise<TiebaCandidate[]> {
  const payload: { bar?: string; since: string; until: string; limit?: number } = {
    since: input.since,
    until: input.until,
  }
  const bar = input.bar?.trim()
  if (bar) payload.bar = bar
  if (input.limit !== undefined) payload.limit = input.limit
  const body = await request(TIEBA_SCAN_PATH, { method: 'POST', body: payload })
  return readCandidates(body)
}

/** 点选候选后再抓帖入库。响应和 by-url 相同。 */
export async function importTiebaUrl(url: string): Promise<Card> {
  const body = await request(TIEBA_IMPORT_PATH, { method: 'POST', body: { url } })
  return readCard(body)
}
