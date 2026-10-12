import { DEFAULT_API_BASE_URL, getApiBaseUrl, resetApiBaseUrl, saveApiBaseUrl } from '../../config'

interface DisclaimerData {
  apiBaseUrl: string
  hint: string
}

Page<DisclaimerData, {
  onInput: (event: WechatMiniprogram.Input) => void
  onSave: () => void
  onReset: () => void
}>({
  data: {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    hint: '',
  },

  onShow() {
    this.setData({ apiBaseUrl: getApiBaseUrl(), hint: '' })
  },

  onInput(event: WechatMiniprogram.Input) {
    this.setData({ apiBaseUrl: event.detail.value, hint: '' })
  },

  onSave() {
    const value = this.data.apiBaseUrl.trim().replace(/\/$/, '')
    // 只接受 http(s)，避免把任意字符串写进后续请求地址
    if (!/^https?:\/\/\S+$/i.test(value)) {
      this.setData({ hint: '请填写以 http:// 或 https:// 开头的地址' })
      return
    }
    saveApiBaseUrl(value)
    this.setData({ apiBaseUrl: value, hint: '已保存。返回列表后会向这个地址请求已发布条目。' })
  },

  onReset() {
    resetApiBaseUrl()
    this.setData({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      hint: `已恢复默认地址 ${DEFAULT_API_BASE_URL}`,
    })
  },
})
