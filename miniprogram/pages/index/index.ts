import { listPublishedCards } from '../../services/cards'
import type { CardScope } from '../../types/card'
import { toUiError } from '../../utils/errors'
import { emptyTextForScope, toCardView } from '../../utils/format'
import type { CardView } from '../../utils/format'

interface IndexData {
  scope: CardScope
  cards: CardView[]
  loading: boolean
  errorMessage: string
  errorCode: string
  emptyText: string
}

type IndexCustom = {
  requestSerial: number
  fetchList: (scope: CardScope) => Promise<void>
  onSwitchScope: (event: WechatMiniprogram.TouchEvent) => void
  onRetry: () => void
  onOpenDetail: (event: WechatMiniprogram.TouchEvent) => void
}

Page<IndexData, IndexCustom>({
  data: {
    scope: 'today',
    cards: [],
    loading: true,
    errorMessage: '',
    errorCode: '',
    emptyText: emptyTextForScope('today'),
  },

  requestSerial: 0,

  onLoad() {
    void this.fetchList('today')
  },

  onPullDownRefresh() {
    this.fetchList(this.data.scope).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onSwitchScope(event: WechatMiniprogram.TouchEvent) {
    const scope = event.currentTarget.dataset.scope as CardScope
    if (scope !== 'today' && scope !== 'week') return
    if (scope === this.data.scope) return
    this.setData({ scope, emptyText: emptyTextForScope(scope) })
    void this.fetchList(scope)
  },

  onRetry() {
    void this.fetchList(this.data.scope)
  },

  onOpenDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` })
  },

  async fetchList(scope: CardScope) {
    // setData 是异步的，用序号丢掉过期响应，避免切 tab 后一直停在「正在读取」
    const serial = this.requestSerial + 1
    this.requestSerial = serial
    this.setData({ loading: true, errorMessage: '', errorCode: '' })
    try {
      const cards = await listPublishedCards(scope)
      if (serial !== this.requestSerial) return
      this.setData({
        loading: false,
        cards: cards.map(toCardView),
        emptyText: emptyTextForScope(scope),
      })
    } catch (error) {
      if (serial !== this.requestSerial) return
      const parsed = toUiError(error)
      this.setData({
        loading: false,
        cards: [],
        errorMessage: parsed.message,
        errorCode: parsed.code,
      })
    }
  },
})
