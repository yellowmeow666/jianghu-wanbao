export type CardStatus = 'draft' | 'pending' | 'published' | 'archived'

export interface TimelineNode {
  at: string
  text: string
}

/** 与 docs/API.md 的 Card 一致。id、created_at、updated_at 只由服务端返回。 */
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
  /** 贴吧入库草稿会带原帖地址。普通录入没有这个字段时为空串。 */
  source_url: string
}

/** POST / PATCH 可写字段。创建时不要带 status，服务端固定为 draft。 */
export interface CardInput {
  title: string
  summary: string
  timeline: TimelineNode[]
  source_platform: string
  source_type: string
  clarified: boolean
}

export type CardPatch = Partial<CardInput> & {
  status?: CardStatus
}
