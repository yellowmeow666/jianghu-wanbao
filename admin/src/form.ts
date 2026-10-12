import type { Card, CardInput, TimelineNode } from './types.ts'

export interface TimelineDraft {
  atLocal: string
  /** 无法放进时间控件时保留原字符串，保存时若没重选则原样提交。 */
  atRaw: string
  text: string
}

export interface CardForm {
  title: string
  summary: string
  source_platform: string
  source_type: string
  clarified: boolean
  timeline: TimelineDraft[]
}

export function blankNode(): TimelineDraft {
  return { atLocal: '', atRaw: '', text: '' }
}

export function emptyForm(): CardForm {
  return {
    title: '',
    summary: '',
    source_platform: '',
    source_type: '',
    clarified: false,
    timeline: [blankNode()],
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** datetime-local 没有时区，按浏览器本地时间理解，再收成 ISO 8601。 */
export function localInputToIso(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

export function isoToLocalInput(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formFromCard(card: Card): CardForm {
  const timeline = card.timeline.map((node) => {
    const atLocal = isoToLocalInput(node.at)
    return {
      atLocal,
      atRaw: atLocal ? '' : node.at,
      text: node.text,
    }
  })

  return {
    title: card.title,
    summary: card.summary,
    source_platform: card.source_platform,
    source_type: card.source_type,
    clarified: card.clarified,
    timeline: timeline.length > 0 ? timeline : [blankNode()],
  }
}

function resolveAt(node: TimelineDraft): string {
  if (node.atLocal) return localInputToIso(node.atLocal)
  return node.atRaw.trim()
}

export interface BuiltTimeline {
  nodes: TimelineNode[]
  issues: string[]
}

/** 整行空白会在提交时丢掉；只填了一半则拦住，避免悄悄弄丢文字。 */
export function buildTimeline(form: CardForm): BuiltTimeline {
  const nodes: TimelineNode[] = []
  const issues: string[] = []

  form.timeline.forEach((node, index) => {
    const at = resolveAt(node)
    const text = node.text.trim()
    const touched = Boolean(node.atLocal || node.atRaw.trim() || text)
    if (!touched) return

    const row = index + 1
    if (node.atLocal && !at) {
      issues.push(`时间线第 ${row} 行的时间无法识别`)
      return
    }
    if (!at || !text) {
      issues.push(`时间线第 ${row} 行需要同时有时间和文字`)
      return
    }
    nodes.push({ at, text })
  })

  return { nodes, issues }
}

export function toCardInput(form: CardForm): CardInput {
  return {
    title: form.title.trim(),
    summary: form.summary.trim(),
    timeline: buildTimeline(form).nodes,
    source_platform: form.source_platform.trim(),
    source_type: form.source_type.trim(),
    clarified: form.clarified,
  }
}

/** 保存草稿 / 待审只拦半行时间线。标题等可以先空着。 */
export function saveIssues(form: CardForm): string[] {
  return buildTimeline(form).issues
}

/** 与 publish 接口一致：四个文本字段非空，且 timeline 至少一条完整节点。 */
export function publishIssues(form: CardForm): string[] {
  const built = buildTimeline(form)
  const issues = [...built.issues]
  if (!form.title.trim()) issues.push('发布前需要标题')
  if (!form.summary.trim()) issues.push('发布前需要摘要')
  if (!form.source_platform.trim()) issues.push('发布前需要来源平台')
  if (!form.source_type.trim()) issues.push('发布前需要来源类型')
  if (built.nodes.length < 1) issues.push('发布前至少要有一个时间线节点')
  return issues
}
