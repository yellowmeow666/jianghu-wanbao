import { useEffect, useState } from 'react'
import { listCards, publishCard, unpublishCard, updateCard } from '../api.ts'
import { STATUS_LABEL, formatDateTime } from '../format.ts'
import { toUiError } from '../model.ts'
import type { Card, CardStatus } from '../types.ts'

const PAGE_SIZE = 50

const FILTERS: Array<{ value: '' | CardStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已下架' },
]

interface CardListProps {
  reloadToken: number
  onCreate: () => void
  onEdit: (card: Card) => void
}

export function CardList({ reloadToken, onCreate, onEdit }: CardListProps) {
  const [filter, setFilter] = useState<'' | CardStatus>('')
  const [items, setItems] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<{ message: string; code: string } | null>(null)
  const [busyId, setBusyId] = useState('')
  const [query, setQuery] = useState({ filter, reloadToken })

  // 筛选或连接变更时先清空旧列表，避免上一轮结果冒充新数据
  if (query.filter !== filter || query.reloadToken !== reloadToken) {
    setQuery({ filter, reloadToken })
    setLoading(true)
    setError(null)
    setItems([])
    setHasMore(false)
  }

  useEffect(() => {
    let cancelled = false
    listCards({ status: filter, limit: PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (cancelled) return
        setItems(page)
        setHasMore(page.length === PAGE_SIZE)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setItems([])
        setHasMore(false)
        setError(toUiError(reason))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filter, reloadToken])

  async function loadMore() {
    setLoadingMore(true)
    setError(null)
    try {
      const page = await listCards({ status: filter, limit: PAGE_SIZE, offset: items.length })
      setItems((current) => [...current, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } catch (reason) {
      setError(toUiError(reason))
    } finally {
      setLoadingMore(false)
    }
  }

  async function runStatusAction(card: Card, action: 'review' | 'publish' | 'unpublish') {
    if (action === 'publish') {
      const ok = window.confirm('发布后，小程序今日/本周可以读到这条已发布条目。继续？')
      if (!ok) return
    }
    if (action === 'unpublish') {
      const ok = window.confirm('下架后读者端将不再返回这条。继续？')
      if (!ok) return
    }

    setBusyId(card.id)
    setError(null)
    try {
      // 待审只改 status；发布和下架走各自的动作接口，不靠 PATCH 假装流转
      if (action === 'review') await updateCard(card.id, { status: 'pending' })
      if (action === 'publish') await publishCard(card.id)
      if (action === 'unpublish') await unpublishCard(card.id)
      const page = await listCards({ status: filter, limit: PAGE_SIZE, offset: 0 })
      setItems(page)
      setHasMore(page.length === PAGE_SIZE)
    } catch (reason) {
      setError(toUiError(reason))
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>条目</h2>
          <p>草稿可以先空着。发布前要补齐标题、摘要、来源和时间线。</p>
        </div>
        <button type="button" className="solid" onClick={onCreate}>新建草稿</button>
      </div>

      <div className="filters" role="tablist">
        {FILTERS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={filter === item.value ? 'chip chip-on' : 'chip'}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="banner" role="alert">
          <strong>{error.message}</strong>
          <span>{error.code}</span>
        </div>
      ) : null}

      {loading ? <p className="muted">正在读取条目…</p> : null}

      {!loading && items.length === 0 ? (
        <div className="empty">
          <h3>这里还空着</h3>
          <p>{error ? '上面的错误排除后可以重试。' : '这个筛选下没有条目。后端未就绪时也会停在这里，不会填入样例。'}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="card-list">
          {items.map((card) => (
            <li key={card.id} className="card-row">
              <div>
                <div className="row-top">
                  <span className={`status status-${card.status}`}>{STATUS_LABEL[card.status]}</span>
                  <span className="muted">更新于 {formatDateTime(card.updated_at)}</span>
                </div>
                <h3>{card.title || '（无标题）'}</h3>
                <p>{card.summary || '摘要还空着'}</p>
                <p className="muted">
                  {card.source_platform || '来源平台待补'} · {card.source_type || '来源类型待补'}
                  {' · '}
                  {card.clarified ? '已标记澄清' : '未标记澄清'}
                  {' · '}
                  时间线 {card.timeline.length} 节
                </p>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => onEdit(card)}>编辑</button>
                {card.status === 'draft' ? (
                  <button type="button" disabled={busyId === card.id} onClick={() => void runStatusAction(card, 'review')}>
                    提交待审
                  </button>
                ) : null}
                {card.status === 'pending' ? (
                  <button type="button" className="solid" disabled={busyId === card.id} onClick={() => void runStatusAction(card, 'publish')}>
                    发布
                  </button>
                ) : null}
                {card.status === 'published' ? (
                  <button type="button" className="danger" disabled={busyId === card.id} onClick={() => void runStatusAction(card, 'unpublish')}>
                    下架
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {hasMore ? (
        <button type="button" className="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? '正在加载…' : '再加载 50 条'}
        </button>
      ) : null}
    </section>
  )
}
