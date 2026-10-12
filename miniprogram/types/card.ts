/** 契约状态。小程序只渲染 published，其余状态视为不该出现在 C 端。 */
export type CardStatus = 'draft' | 'pending' | 'published' | 'archived'

export interface TimelineNode {
  at: string
  text: string
}

/** 字段名与 docs/API.md 的 Card 一致。id / created_at / updated_at 只读。 */
export interface Card {
  id: string
  title: string
  summary: string
  timeline: TimelineNode[]
  source_platform: string
  source_type: string
  clarified: boolean
  status: CardStatus
  created_at: string
  updated_at: string
}

export type CardScope = 'today' | 'week'
