import type { Card, CardScope } from '../types/card'

export interface TimelineView {
  atLabel: string
  text: string
}

export interface CardView {
  id: string
  title: string
  summary: string
  sourcePlatform: string
  sourceType: string
  clarifiedLabel: string
  clarified: boolean
  updatedLabel: string
  createdLabel: string
  timeline: TimelineView[]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 能解析的 ISO 时间按设备本地时区显示到分钟；解析不了就原样展示。 */
export function formatDateTime(value: string): string {
  if (!value) return '时间待补'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 「已澄清」只是编辑标记，不能写成定论或机构口吻。 */
export function clarifiedLabel(clarified: boolean): string {
  return clarified ? '已标记澄清' : '未标记澄清'
}

export function emptyTextForScope(scope: CardScope): string {
  return scope === 'today' ? '今日还没有已发布的条目。' : '本周还没有已发布的条目。'
}

export function toCardView(card: Card): CardView {
  return {
    id: card.id,
    title: card.title || '（无标题）',
    summary: card.summary || '摘要待补',
    sourcePlatform: card.source_platform || '待补',
    sourceType: card.source_type || '待补',
    clarifiedLabel: clarifiedLabel(card.clarified),
    clarified: card.clarified,
    updatedLabel: formatDateTime(card.updated_at),
    createdLabel: formatDateTime(card.created_at),
    timeline: card.timeline.map((node) => ({
      atLabel: formatDateTime(node.at),
      text: node.text || '这一节点还没有文字',
    })),
  }
}
