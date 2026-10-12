import type { Card, CardStatus, TimelineNode } from './types.ts'

const STATUSES: readonly CardStatus[] = ['draft', 'pending', 'published', 'archived']

export class ApiError extends Error {
  code: string
  statusCode: number

  constructor(message: string, code: string, statusCode: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key]
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  return false
}

function readTimeline(source: Record<string, unknown>): TimelineNode[] {
  if (!Array.isArray(source.timeline)) return []
  const nodes: TimelineNode[] = []
  for (const item of source.timeline) {
    if (!isRecord(item)) continue
    nodes.push({
      at: readString(item, ['at']),
      text: readString(item, ['text']),
    })
  }
  return nodes
}

function isStatus(value: string): value is CardStatus {
  return (STATUSES as readonly string[]).includes(value)
}

/** 把契约 Card 从未知 JSON 里读出来。草稿标题允许为空，所以不拿 title 当存在性判断。 */
export function normalizeCard(input: unknown): Card | null {
  if (!isRecord(input)) return null
  const id = readString(input, ['id'])
  const status = readString(input, ['status'])
  if (!id || !isStatus(status)) return null

  return {
    id,
    title: readString(input, ['title']),
    summary: readString(input, ['summary']),
    timeline: readTimeline(input),
    source_platform: readString(input, ['source_platform']),
    source_type: readString(input, ['source_type']),
    clarified: readBoolean(input, 'clarified'),
    status,
    created_at: readString(input, ['created_at']),
    updated_at: readString(input, ['updated_at']),
  }
}

export function readCard(input: unknown): Card {
  const card = normalizeCard(input)
  if (!card) {
    throw new ApiError('条目响应无法识别', 'invalid_response', 200)
  }
  return card
}

/** 管理列表契约是 { items: Card[] }。空数组是合法结果，缺 items 不是。 */
export function readCardList(input: unknown): Card[] {
  if (!isRecord(input) || !Array.isArray(input.items)) {
    throw new ApiError('响应里没有 items 列表', 'invalid_response', 200)
  }

  return input.items.map((item, index) => {
    const card = normalizeCard(item)
    if (!card) {
      throw new ApiError(`第 ${index + 1} 条条目无法识别`, 'invalid_response', 200)
    }
    return card
  })
}

/** 失败体契约：{ error: { code, message } }。网络失败也收成同一种错误。 */
export function parseErrorBody(body: unknown, statusCode: number): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const code = typeof body.error.code === 'string' && body.error.code.trim()
      ? body.error.code
      : `HTTP_${statusCode}`
    const message = typeof body.error.message === 'string' && body.error.message.trim()
      ? body.error.message
      : fallbackMessage(code, statusCode)
    return new ApiError(message, code, statusCode)
  }

  if (typeof body === 'string' && body.trim()) {
    return new ApiError(body.trim().slice(0, 180), `HTTP_${statusCode}`, statusCode)
  }

  return new ApiError(fallbackMessage('', statusCode), `HTTP_${statusCode}`, statusCode)
}

function fallbackMessage(code: string, statusCode: number): string {
  if (code === 'UNAUTHORIZED' || statusCode === 401) return '管理令牌未被接受'
  if (code === 'NOT_FOUND' || statusCode === 404) return '没有找到这条条目'
  if (code === 'INVALID_BODY' || statusCode === 400) return '提交的内容不符合要求'
  if (statusCode === 0) return '无法连接整理服务'
  return '请求没有成功'
}

export function toUiError(error: unknown): { message: string; code: string } {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code }
  }
  return { message: '操作没有完成，请稍后再试。', code: 'client_error' }
}
