import type { CardStatus } from './types.ts'

export const STATUS_LABEL: Record<CardStatus, string> = {
  draft: '草稿',
  pending: '待审',
  published: '已发布',
  archived: '已下架',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(value: string): string {
  if (!value) return '时间待补'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
