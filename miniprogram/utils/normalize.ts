import type { Card, CardStatus } from '../types/card'
import { ApiError } from './errors'

const STATUSES: readonly CardStatus[] = ['draft', 'pending', 'published', 'archived']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 契约要求 snake_case。
 * 同时接受同义 camelCase，避免联调时整页被命名风格打空；写请求的一侧只发 snake_case。
 */
function readString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readBoolean(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1) return true
    if (value === 'false' || value === 0) return false
  }
  return false
}

function readStatus(source: Record<string, unknown>): CardStatus | null {
  const raw = readString(source, ['status'])
  if ((STATUSES as readonly string[]).includes(raw)) return raw as CardStatus
  return null
}

function readTimeline(source: Record<string, unknown>): Card['timeline'] {
  const raw = source.timeline
  if (!Array.isArray(raw)) return []

  const nodes: Card['timeline'] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const at = readString(item, ['at'])
    const text = readString(item, ['text'])
    if (!at && !text) continue
    nodes.push({ at, text })
  }
  return nodes
}

/** 缺 id 或 status 时返回 null，调用方决定报错，而不是填一条假卡。 */
export function normalizeCard(input: unknown): Card | null {
  if (!isRecord(input)) return null

  const id = readString(input, ['id', '_id'])
  const status = readStatus(input)
  if (!id || !status) return null

  return {
    id,
    title: readString(input, ['title']),
    summary: readString(input, ['summary']),
    timeline: readTimeline(input),
    source_platform: readString(input, ['source_platform', 'sourcePlatform']),
    source_type: readString(input, ['source_type', 'sourceType']),
    clarified: readBoolean(input, ['clarified']),
    status,
    created_at: readString(input, ['created_at', 'createdAt']),
    updated_at: readString(input, ['updated_at', 'updatedAt']),
  }
}

/**
 * 列表契约是 { items: Card[] }。
 * 空 items 是合法空态；缺 items、条目无法识别、或混入未发布状态都报错，
 * 避免把契约偏差显示成「今天没有条目」。
 */
export function collectPublishedCards(input: unknown): Card[] {
  if (!isRecord(input) || !Array.isArray(input.items)) {
    throw new ApiError('响应里没有 items 列表', 'invalid_response', 200)
  }

  const published: Card[] = []
  for (const item of input.items) {
    const card = normalizeCard(item)
    if (!card) {
      throw new ApiError('条目响应无法识别', 'invalid_response', 200)
    }
    if (card.status !== 'published') {
      throw new ApiError('接口返回了未发布条目', 'not_published', 200)
    }
    published.push(card)
  }
  return published
}

/** 详情契约直接返回 Card。非 published 在服务端应是 404；这里再挡一层。 */
export function readPublishedCard(input: unknown): Card {
  const card = normalizeCard(input)
  if (!card) {
    throw new ApiError('条目响应无法识别', 'invalid_response', 200)
  }
  if (card.status !== 'published') {
    throw new ApiError('这条条目尚未发布', 'not_published', 200)
  }
  return card
}
