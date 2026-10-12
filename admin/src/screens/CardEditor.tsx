import { useState } from 'react'
import { createCard, publishCard, unpublishCard, updateCard } from '../api.ts'
import {
  blankNode,
  emptyForm,
  formFromCard,
  publishIssues,
  saveIssues,
  toCardInput,
  type CardForm,
} from '../form.ts'
import { STATUS_LABEL, formatDateTime } from '../format.ts'
import { ApiError, toUiError } from '../model.ts'
import type { Card, CardStatus } from '../types.ts'

interface CardEditorProps {
  card: Card | null
  onCancel: () => void
  onSaved: (card: Card) => void
}

type SaveMode = 'draft' | 'review' | 'publish' | 'unpublish'

export function CardEditor({ card, onCancel, onSaved }: CardEditorProps) {
  const [form, setForm] = useState<CardForm>(() => (card ? formFromCard(card) : emptyForm()))
  const [status, setStatus] = useState<CardStatus>(card?.status ?? 'draft')
  const [cardId, setCardId] = useState(card?.id ?? '')
  const [updatedAt, setUpdatedAt] = useState(card?.updated_at ?? '')
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<{ message: string; code: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function patchForm(partial: Partial<CardForm>) {
    setForm((current) => ({ ...current, ...partial }))
    setNotice('')
  }

  function patchNode(index: number, partial: Partial<CardForm['timeline'][number]>) {
    setForm((current) => ({
      ...current,
      timeline: current.timeline.map((node, nodeIndex) => (
        nodeIndex === index ? { ...node, ...partial } : node
      )),
    }))
    setNotice('')
  }

  function moveNode(index: number, direction: -1 | 1) {
    setForm((current) => {
      const next = current.timeline.slice()
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [node] = next.splice(index, 1)
      next.splice(target, 0, node)
      return { ...current, timeline: next }
    })
  }

  async function submit(mode: SaveMode) {
    const contentIssues = mode === 'publish' ? publishIssues(form) : saveIssues(form)
    if (contentIssues.length > 0) {
      setIssues(contentIssues)
      setError(null)
      return
    }
    if (mode === 'publish') {
      const ok = window.confirm('发布后，小程序今日/本周可以读到这条。继续？')
      if (!ok) return
    }
    if (mode === 'unpublish') {
      const ok = window.confirm('下架后读者端将不再返回这条。未通过校验的半行时间线会先拦住。继续？')
      if (!ok) return
    }

    setBusy(true)
    setIssues([])
    setError(null)
    setNotice('')
    const input = toCardInput(form)

    try {
      const saved = await persistContent(cardId, input, mode)
      // 用服务端返回的卡片回填，避免本地时间和状态停在提交前
      setForm(formFromCard(saved))
      setCardId(saved.id)
      setStatus(saved.status)
      setUpdatedAt(saved.updated_at)
      onSaved(saved)
      setNotice(noticeFor(saved.status, mode))
    } catch (reason) {
      setError(toUiError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{cardId ? '编辑条目' : '新建草稿'}</h2>
          <p>
            {cardId ? `编号 ${cardId} · ${STATUS_LABEL[status]} · 更新于 ${formatDateTime(updatedAt)}` : '保存后才会向服务端要编号。新建一定是草稿。'}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onCancel}>返回列表</button>
      </div>

      {error ? (
        <div className="banner" role="alert">
          <strong>{error.message}</strong>
          <span>{error.code}</span>
        </div>
      ) : null}
      {issues.length > 0 ? (
        <ul className="issues">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault()
          void submit('draft')
        }}
      >
        <label>
          标题
          <input value={form.title} onChange={(event) => patchForm({ title: event.target.value })} />
        </label>
        <label>
          摘要
          <textarea rows={4} value={form.summary} onChange={(event) => patchForm({ summary: event.target.value })} />
        </label>
        <div className="split">
          <label>
            来源平台
            <input value={form.source_platform} onChange={(event) => patchForm({ source_platform: event.target.value })} />
          </label>
          <label>
            来源类型
            <input value={form.source_type} onChange={(event) => patchForm({ source_type: event.target.value })} />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={form.clarified}
            onChange={(event) => patchForm({ clarified: event.target.checked })}
          />
          标记为已澄清（只是编辑标记，不是定论）
        </label>

        <div className="timeline-head">
          <h3>时间线</h3>
          <button
            type="button"
            className="ghost"
            onClick={() => patchForm({ timeline: [...form.timeline, blankNode()] })}
          >
            添加节点
          </button>
        </div>
        {form.timeline.length === 0 ? <p className="muted">草稿可以没有节点。发布前至少留一条。</p> : null}
        <ol className="timeline">
          {form.timeline.map((node, index) => (
            <li key={`${cardId}-${index}`}>
              <div className="node-tools">
                <span>节点 {index + 1}</span>
                <button type="button" className="ghost" onClick={() => moveNode(index, -1)} disabled={index === 0}>上移</button>
                <button type="button" className="ghost" onClick={() => moveNode(index, 1)} disabled={index === form.timeline.length - 1}>下移</button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => patchForm({ timeline: form.timeline.filter((_, nodeIndex) => nodeIndex !== index) })}
                >
                  删除
                </button>
              </div>
              <label>
                时间
                <input
                  type="datetime-local"
                  value={node.atLocal}
                  onChange={(event) => patchNode(index, { atLocal: event.target.value, atRaw: '' })}
                />
              </label>
              {node.atRaw ? <p className="muted">原时间无法放进控件，保存时会保留：{node.atRaw}</p> : null}
              <label>
                发生了什么
                <textarea rows={3} value={node.text} onChange={(event) => patchNode(index, { text: event.target.value })} />
              </label>
            </li>
          ))}
        </ol>

        <div className="editor-actions">
          <button type="submit" disabled={busy}>保存</button>
          {status === 'draft' && cardId ? (
            <button type="button" disabled={busy} onClick={() => void submit('review')}>提交待审</button>
          ) : null}
          {status === 'pending' ? (
            <button type="button" className="solid" disabled={busy} onClick={() => void submit('publish')}>发布</button>
          ) : null}
          {status === 'published' ? (
            <button type="button" className="danger" disabled={busy} onClick={() => void submit('unpublish')}>下架</button>
          ) : null}
        </div>
        <p className="muted">
          流转是草稿、待审、发布、下架。待审走 PATCH status，发布和下架走对应接口。
        </p>
      </form>
    </section>
  )
}

async function persistContent(cardId: string, input: ReturnType<typeof toCardInput>, mode: SaveMode): Promise<Card> {
  // 新建只能先落成草稿。待审要等有了 id 再 PATCH，避免创建成功但改状态失败时重复插入。
  if (!cardId) {
    if (mode !== 'draft') {
      throw new ApiError('请先保存草稿，再继续状态流转', 'client_error', 0)
    }
    return createCard(input)
  }

  if (mode === 'review') {
    return updateCard(cardId, { ...input, status: 'pending' })
  }

  const saved = await updateCard(cardId, input)
  if (mode === 'publish') return publishCard(saved.id)
  if (mode === 'unpublish') return unpublishCard(saved.id)
  return saved
}

function noticeFor(status: CardStatus, mode: SaveMode): string {
  if (mode === 'review') return '已提交待审。'
  if (mode === 'publish' && status === 'published') return '已发布。小程序只会读到已发布条目。'
  if (mode === 'unpublish' && status === 'archived') return '已下架。读者端不会再返回这条。'
  return '已保存。'
}
