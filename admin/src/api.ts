import { readCard, readCardList, ApiError, parseErrorBody } from './model.ts'
import { readSettings } from './settings.ts'
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
