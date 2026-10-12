const BASE_KEY = 'jianghu.admin.apiBaseUrl'
const TOKEN_KEY = 'jianghu.admin.token'

export interface Settings {
  apiBaseUrl: string
  adminToken: string
}

function envBase(): string {
  const value = import.meta.env.VITE_API_BASE_URL
  return (typeof value === 'string' && value.trim()) || 'http://localhost:3000'
}

function envToken(): string {
  const value = import.meta.env.VITE_ADMIN_TOKEN
  // 这是本地联调默认值，不是生产密钥。部署时用环境变量覆盖。
  return (typeof value === 'string' && value.trim()) || 'dev-admin-token'
}

export function readSettings(): Settings {
  const fallback = {
    apiBaseUrl: envBase().replace(/\/$/, ''),
    adminToken: envToken(),
  }
  try {
    const storedBase = localStorage.getItem(BASE_KEY)?.trim()
    const storedToken = localStorage.getItem(TOKEN_KEY)?.trim()
    return {
      apiBaseUrl: (storedBase || fallback.apiBaseUrl).replace(/\/$/, ''),
      adminToken: storedToken || fallback.adminToken,
    }
  } catch {
    return fallback
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(BASE_KEY, settings.apiBaseUrl.trim().replace(/\/$/, ''))
  localStorage.setItem(TOKEN_KEY, settings.adminToken.trim())
}

export function clearSettings(): void {
  localStorage.removeItem(BASE_KEY)
  localStorage.removeItem(TOKEN_KEY)
}
