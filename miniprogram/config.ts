/**
 * C 端 API 根地址。
 * 默认连本机后端。阅读须知页可以改地址并写入本地存储，存储值优先于这里的默认值。
 * 不提供假数据开关：接口失败时只显示错误或空列表，不用样例条目冒充已发布内容。
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000'

const STORAGE_KEY = 'apiBaseUrl'

export function getApiBaseUrl(): string {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim()) {
      return stored.trim().replace(/\/$/, '')
    }
  } catch {
    // 存储不可用时退回默认地址，首页仍可发起请求并给出错误提示
  }
  return DEFAULT_API_BASE_URL
}

export function saveApiBaseUrl(url: string): void {
  wx.setStorageSync(STORAGE_KEY, url.replace(/\/$/, ''))
}

export function resetApiBaseUrl(): void {
  wx.removeStorageSync(STORAGE_KEY)
}
