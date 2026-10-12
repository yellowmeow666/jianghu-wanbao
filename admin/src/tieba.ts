import { ApiError } from './model.ts'

/** 小杨采集契约路径。扫描字段是 bar，不是 bar_name。 */
export const TIEBA_BY_URL_PATH = '/api/admin/ingest/tieba/by-url'
export const TIEBA_SCAN_PATH = '/api/admin/ingest/tieba/scan'
export const TIEBA_IMPORT_PATH = '/api/admin/ingest/tieba/import'
export const TIEBA_COOKIE_PATH = '/api/admin/ingest/tieba/cookie'

export const DEFAULT_TIEBA_BAR = '剑网3'

export interface TiebaCandidate {
  title: string
  posted_at: string
  url: string
  score: number
  reasons: string[]
}

export interface TiebaScanInput {
  bar?: string
  since: string
  until: string
  limit?: number
}

const INGEST_HINTS: Record<string, string> = {
  INVALID_URL: '这条链接无法识别。请粘贴贴吧帖子的完整地址。',
  INVALID_BODY: '提交的内容不符合要求。请检查链接，或把开始和结束时间填完整。',
  UNAUTHORIZED: '管理令牌未被接受。请核对上方的令牌后再试。',
  NOT_FOUND: '没有找到这篇帖子，可能已经删了。',
  ALREADY_EXISTS: '这篇帖已经入库，正在打开已有草稿。',
  RATE_LIMITED: '取帖太频繁，请稍后再试。',
  FETCH_FAILED: '贴吧页面没有取下来，可以重试。',
  CAPTCHA: '贴吧要求验证，这次没有取到内容。请稍后再试。',
  INTERNAL: '整理服务出错了，可以重试。',
  network_error: '连不上整理服务。请确认后端已启动，以及 API 地址。',
}

/**
 * 已知失败码给人话；服务端 message 不同时附在后面。
 * 非法链接是 INVALID_URL 400。CAPTCHA 是 403，FETCH_FAILED 是 502，ALREADY_EXISTS 是 409 且同级带 card_id。
 */
export function explainIngestError(error: ApiError): string {
  const urlProblem = error.code === 'INVALID_BODY' && /url/i.test(error.message)
  const hint = (urlProblem ? INGEST_HINTS.INVALID_URL : INGEST_HINTS[error.code])
    ?? (error.message.trim() || '取帖没有完成。')
  const server = error.message.trim()
  if (!server || server === hint) return hint
  return `${hint} ${server}`
}

export type TiebaCookieStatus = 'missing' | 'valid' | 'expired'
export type TiebaCookieFormat = 'netscape' | 'json'

export interface TiebaCookieState {
  status: TiebaCookieStatus
  updated_at: string | null
}

export const COOKIE_STATUS_LABEL: Record<TiebaCookieStatus, string> = {
  missing: '未配置',
  valid: '有效',
  expired: '已过期',
}

const COOKIE_ERROR_HINTS: Record<string, string> = {
  INVALID_BODY: '这组 Cookie 没能解析。请核对所选格式后重新粘贴。',
  INTERNAL: '整理服务没有存下 Cookie，可以重试。',
  UNAUTHORIZED: '管理令牌未被接受。请核对上方的令牌后再试。',
  network_error: '连不上整理服务。请确认后端已启动，以及 API 地址。',
}

/**
 * Cookie 失败只按错误码给人话。
 * 不拼接服务端 message，避免把粘贴内容抄进提示。
 */
export function explainCookieError(error: ApiError): string {
  return COOKIE_ERROR_HINTS[error.code] ?? 'Cookie 没有保存成功。'
}

/** 验证码提示保持不变；只有后端标明过期，或就是验证码，才再拉状态。 */
export function shouldRefreshCookieStatus(error: ApiError): boolean {
  return error.code === 'CAPTCHA' || error.cookieMarkedExpired
}

/** 只留状态和时间。响应里若多带 content，也不放进返回值。 */
export function readCookieState(input: unknown): TiebaCookieState {
  if (!isRecord(input)) {
    throw new ApiError('Cookie 状态无法识别', 'invalid_response', 200)
  }
  const status = input.status
  if (status !== 'missing' && status !== 'valid' && status !== 'expired') {
    throw new ApiError('Cookie 状态无法识别', 'invalid_response', 200)
  }
  const updated = input.updated_at
  if (updated === null || updated === undefined || updated === '') {
    return { status, updated_at: null }
  }
  if (typeof updated !== 'string') {
    throw new ApiError('Cookie 状态无法识别', 'invalid_response', 200)
  }
  return { status, updated_at: updated.trim() || null }
}

/** 和 backend normalizeTiebaPostUrl 同一条规则，避免非法链接先打到限流。 */
export function localTiebaUrlIssue(raw: string): string | null {
  const value = raw.trim()
  if (!value) return '请先粘贴贴吧帖子链接。'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return '这条链接无法识别。请粘贴贴吧帖子地址，形如 https://tieba.baidu.com/p/数字。'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '链接需要以 http:// 或 https:// 开头。'
  }
  if (parsed.hostname.toLowerCase() !== 'tieba.baidu.com' || !/^\/p\/\d+\/?$/.test(parsed.pathname)) {
    return '请粘贴贴吧帖子地址，形如 https://tieba.baidu.com/p/数字。'
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value === 'string') return value.trim()
  return ''
}

function readScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** 扫描成功体是 { candidates }，不会落库。缺 candidates 不能当成「没有帖」。 */
export function readCandidates(input: unknown): TiebaCandidate[] {
  if (!isRecord(input) || !Array.isArray(input.candidates)) {
    throw new ApiError('响应里没有 candidates', 'invalid_response', 200)
  }

  return input.candidates.map((item, index) => {
    if (!isRecord(item)) {
      throw new ApiError(`第 ${index + 1} 条候选无法识别`, 'invalid_response', 200)
    }
    const url = readString(item, 'url')
    const score = readScore(item.score)
    if (!url || score === null) {
      throw new ApiError(`第 ${index + 1} 条候选缺少链接或分数`, 'invalid_response', 200)
    }
    const reasons = Array.isArray(item.reasons)
      ? item.reasons.filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
      : []
    if (item.reasons !== undefined && !Array.isArray(item.reasons)) {
      throw new ApiError(`第 ${index + 1} 条候选的理由格式不对`, 'invalid_response', 200)
    }
    return {
      title: readString(item, 'title'),
      posted_at: readString(item, 'posted_at'),
      url,
      score,
      reasons,
    }
  })
}

function shanghaiParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  // 个别环境在午夜会给出 24 点，收成 00，避免拼出非法时间
  const hour = pick('hour') === '24' ? '00' : pick('hour')
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour,
    minute: pick('minute'),
    second: pick('second'),
  }
}

/** 契约要求 since / until 用带 +08:00 的 ISO 8601，而不是 UTC 的 Z。 */
export function formatShanghaiOffset(date: Date): string {
  const part = shanghaiParts(date)
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}+08:00`
}

export function formatShanghaiLocalInput(date: Date): string {
  const part = shanghaiParts(date)
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`
}

/** Cookie 更新时间按上海钟点显示，和取帖时间窗同一时区。 */
export function formatCookieUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const part = shanghaiParts(date)
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`
}

/**
 * 时间控件里的数字按上海墙钟原样加 +08:00。
 * 不经过 Date 解析，避免操作者的浏览器时区把钟点挪走。
 */
export function localInputToShanghaiIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return ''
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`
}

export function defaultScanWindow(now = new Date()): { sinceLocal: string; untilLocal: string } {
  return {
    sinceLocal: formatShanghaiLocalInput(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    untilLocal: formatShanghaiLocalInput(now),
  }
}
