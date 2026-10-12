import { getPublishedCard } from '../../services/cards'
import { toCardView } from '../../utils/format'
import type { CardView } from '../../utils/format'
import { toUiError } from '../../utils/errors'

interface DetailData {
  loading: boolean
  errorMessage: string
  errorCode: string
  card: CardView | null
  cardId: string
}

type DetailCustom = {
  fetchCard: (id: string) => Promise<void>
  onRetry: () => void
}

Page<DetailData, DetailCustom>({
  data: {
    loading: true,
    errorMessage: '',
    errorCode: '',
    card: null,
    cardId: '',
  },

  onLoad(query) {
    const raw = query.id ? decodeURIComponent(query.id) : ''
    this.setData({ cardId: raw })
    if (!raw) {
      this.setData({
        loading: false,
        errorMessage: '缺少条目编号',
        errorCode: 'invalid_id',
      })
      return
    }
    void this.fetchCard(raw)
  },

  onRetry() {
    void this.fetchCard(this.data.cardId)
  },

  async fetchCard(id: string) {
    if (!id) return
    this.setData({ loading: true, errorMessage: '', errorCode: '' })
    try {
      const card = await getPublishedCard(id)
      this.setData({ loading: false, card: toCardView(card) })
    } catch (error) {
      const parsed = toUiError(error)
      this.setData({
        loading: false,
        card: null,
        errorMessage: parsed.message,
        errorCode: parsed.code,
      })
    }
  },
})
