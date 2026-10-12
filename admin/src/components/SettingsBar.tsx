import { useState, type FormEvent } from 'react'
import { clearSettings, readSettings, saveSettings } from '../settings.ts'

interface SettingsBarProps {
  onSaved: () => void
}

export function SettingsBar({ onSaved }: SettingsBarProps) {
  const current = readSettings()
  const [apiBaseUrl, setApiBaseUrl] = useState(current.apiBaseUrl)
  const [adminToken, setAdminToken] = useState(current.adminToken)
  const [hint, setHint] = useState('')

  function persist(event: FormEvent) {
    event.preventDefault()
    const nextBase = apiBaseUrl.trim().replace(/\/$/, '')
    const nextToken = adminToken.trim()
    if (!/^https?:\/\/\S+$/i.test(nextBase)) {
      setHint('API 地址需要以 http:// 或 https:// 开头')
      return
    }
    if (!nextToken) {
      setHint('请填写管理令牌。本地默认是 dev-admin-token')
      return
    }
    saveSettings({ apiBaseUrl: nextBase, adminToken: nextToken })
    setApiBaseUrl(nextBase)
    setAdminToken(nextToken)
    setHint('已保存。接下来的请求会带上这个地址和 X-Admin-Token。')
    onSaved()
  }

  function reset() {
    clearSettings()
    const next = readSettings()
    setApiBaseUrl(next.apiBaseUrl)
    setAdminToken(next.adminToken)
    setHint('已恢复环境变量或本地默认值。')
    onSaved()
  }

  return (
    <form className="settings" onSubmit={persist}>
      <label>
        API 地址
        <input
          value={apiBaseUrl}
          onChange={(event) => {
            setApiBaseUrl(event.target.value)
            setHint('')
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label>
        管理令牌
        <input
          type="password"
          value={adminToken}
          onChange={(event) => {
            setAdminToken(event.target.value)
            setHint('')
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="settings-actions">
        <button type="submit">保存连接</button>
        <button type="button" className="ghost" onClick={reset}>恢复默认</button>
      </div>
      <p className="settings-hint">{hint || '令牌只放在请求头 X-Admin-Token，不会写进页面文案。'}</p>
    </form>
  )
}
