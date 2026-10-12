import { useEffect, useState } from 'react'
import { deleteTiebaCookie, getAdminCardById, getTiebaCookie, importTiebaUrl, ingestTiebaByUrl, putTiebaCookie, scanTieba } from '../api.ts'
import { formatDateTime } from '../format.ts'
import { ApiError } from '../model.ts'
import {
  COOKIE_STATUS_LABEL,
  DEFAULT_TIEBA_BAR,
  defaultScanWindow,
  explainCookieError,
  explainIngestError,
  formatCookieUpdatedAt,
  localInputToShanghaiIso,
  localTiebaUrlIssue,
  shouldRefreshCookieStatus,
} from '../tieba.ts'
import type { TiebaCandidate, TiebaCookieFormat, TiebaCookieState } from '../tieba.ts'
import type { Card } from '../types.ts'

interface TiebaIngestProps {
  onOpenCard: (card: Card, note: string) => void
}

interface FailureState {
  hint: string
  code: string
  retry: (() => void) | null
}

/** Cookie 重试只记动作，避免闭包拿住上一次粘贴的正文。 */
type CookieRetry = 'load' | 'put' | 'delete' | null

interface CookieFailure {
  hint: string
  code: string
  retry: CookieRetry
}

const windowDefault = defaultScanWindow()

export function TiebaIngest({ onOpenCard }: TiebaIngestProps) {
  const [url, setUrl] = useState('')
  const [bar, setBar] = useState(DEFAULT_TIEBA_BAR)
  const [sinceLocal, setSinceLocal] = useState(windowDefault.sinceLocal)
  const [untilLocal, setUntilLocal] = useState(windowDefault.untilLocal)
  const [limitText, setLimitText] = useState('50')
  const [candidates, setCandidates] = useState<TiebaCandidate[]>([])
  const [scanned, setScanned] = useState(false)
  const [failure, setFailure] = useState<FailureState | null>(null)
  const [busy, setBusy] = useState('')
  const [cookieState, setCookieState] = useState<TiebaCookieState | null>(null)
  const [cookieFormat, setCookieFormat] = useState<TiebaCookieFormat>('netscape')
  const [cookieText, setCookieText] = useState('')
  const [cookieFailure, setCookieFailure] = useState<CookieFailure | null>(null)
  const [cookieBusy, setCookieBusy] = useState('')

  function cookieError(reason: unknown, retry: CookieRetry): CookieFailure {
    // 只用人话和错误码。服务端 message 可能抄了粘贴内容，不能进提示。
    if (reason instanceof ApiError) {
      return { hint: explainCookieError(reason), code: reason.code, retry }
    }
    return { hint: 'Cookie 操作没有完成。', code: 'client_error', retry }
  }

  async function loadCookie() {
    try {
      const state = await getTiebaCookie()
      setCookieState(state)
      setCookieFailure(null)
    } catch (reason) {
      setCookieFailure(cookieError(reason, 'load'))
    }
  }

  useEffect(() => {
    let cancelled = false
    // 进页只拉状态。setState 放在异步回调里，避免效果函数里同步改状态。
    void getTiebaCookie()
      .then((state) => {
        if (cancelled) return
        setCookieState(state)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setCookieFailure(cookieError(reason, 'load'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  function noteCookieRefresh(error: ApiError) {
    // 验证码文案保持原样。后端把 Cookie 标成过期，或直接返回验证码时，再拉一次状态条。
    if (shouldRefreshCookieStatus(error)) void loadCookie()
  }

  function submitCookie() {
    const content = cookieText
    if (!content.trim()) {
      setCookieFailure({ hint: '请先粘贴导出的 Cookie。', code: 'INVALID_BODY', retry: null })
      return
    }
    setCookieBusy('put')
    setCookieFailure(null)
    void putTiebaCookie({ format: cookieFormat, content })
      .then(async () => {
        // 204 后立刻清框。后面的 GET 失败也不能把正文留在输入框里。
        setCookieText('')
        await loadCookie()
      })
      .catch((reason: unknown) => {
        setCookieFailure(cookieError(reason, 'put'))
      })
      .finally(() => setCookieBusy(''))
  }

  function clearCookie() {
    const confirmed = window.confirm('清除已保存的贴吧 Cookie？清除后状态会回到未配置。')
    if (!confirmed) return
    setCookieBusy('delete')
    setCookieFailure(null)
    void deleteTiebaCookie()
      .then(async () => {
        setCookieText('')
        await loadCookie()
      })
      .catch((reason: unknown) => {
        setCookieFailure(cookieError(reason, 'delete'))
      })
      .finally(() => setCookieBusy(''))
  }

  function retryCookie() {
    if (cookieFailure?.retry === 'load') void loadCookie()
    if (cookieFailure?.retry === 'put') submitCookie()
    if (cookieFailure?.retry === 'delete') clearCookie()
  }

  async function openExistingOrFail(error: ApiError, retry: () => void) {
    // 409 只给 card_id。先翻管理列表把已有草稿找出来，再跳进编辑页。
    if (error.code === 'ALREADY_EXISTS' && error.cardId) {
      try {
        const existing = await getAdminCardById(error.cardId)
        onOpenCard(existing, explainIngestError(error))
        return
      } catch (loadError) {
        const loadHint = loadError instanceof ApiError ? loadError.message : '没有打开已有草稿'
        setFailure({
          hint: `${explainIngestError(error)} ${loadHint}`,
          code: error.code,
          retry,
        })
        return
      }
    }
    setFailure({ hint: explainIngestError(error), code: error.code, retry })
  }

  async function runIngest(targetUrl: string, retry: () => void, request: (value: string) => Promise<Card>) {
    setBusy(targetUrl)
    setFailure(null)
    try {
      const card = await request(targetUrl)
      onOpenCard(card, '')
    } catch (reason) {
      if (reason instanceof ApiError) {
        noteCookieRefresh(reason)
        await openExistingOrFail(reason, retry)
      } else {
        setFailure({ hint: '取帖没有完成。', code: 'client_error', retry })
      }
    } finally {
      setBusy('')
    }
  }

  function importCandidate(targetUrl: string) {
    void runIngest(targetUrl, () => importCandidate(targetUrl), importTiebaUrl)
  }

  function submitUrl() {
    const target = url.trim()
    const urlIssue = localTiebaUrlIssue(target)
    if (urlIssue) {
      setFailure({ hint: urlIssue, code: 'INVALID_URL', retry: null })
      return
    }
    void runIngest(target, () => submitUrl(), ingestTiebaByUrl)
  }

  function submitScan() {
    const since = localInputToShanghaiIso(sinceLocal)
    const until = localInputToShanghaiIso(untilLocal)
    if (!since || !until) {
      setFailure({ hint: '请把开始和结束时间填完整。', code: 'INVALID_BODY', retry: null })
      return
    }
    // 同一套 +08:00 格式可以直接按字符串比较先后
    if (since > until) {
      setFailure({ hint: '开始时间不能晚于结束时间。', code: 'INVALID_BODY', retry: null })
      return
    }
    const limit = Number(limitText)
    // backend 只接受 1..200，超出会直接 INVALID_BODY
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      setFailure({ hint: '条数上限需要是 1 到 200 的整数。', code: 'INVALID_BODY', retry: null })
      return
    }

    setBusy('scan')
    setFailure(null)
    void scanTieba({ bar: bar.trim(), since, until, limit })
      .then((next) => {
        setCandidates(next)
        setScanned(true)
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError) {
          noteCookieRefresh(reason)
          setFailure({ hint: explainIngestError(reason), code: reason.code, retry: () => submitScan() })
          return
        }
        setFailure({ hint: '扫描没有完成。', code: 'client_error', retry: () => submitScan() })
      })
      .finally(() => setBusy(''))
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>贴吧取帖</h2>
          <p>只进整理台草稿，不会出现在小程序。扫描先给候选，入库才抓楼主主楼。</p>
        </div>
      </div>

      <section className="cookie-panel">
        <h3>贴吧 Cookie</h3>
        <div
          className={`cookie-status cookie-${cookieState?.status ?? 'unknown'}`}
          role="status"
          aria-live="polite"
        >
          <span>Cookie</span>
          <strong>
            {cookieState
              ? COOKIE_STATUS_LABEL[cookieState.status]
              : (cookieFailure ? '未能读取' : '正在读取…')}
          </strong>
          {cookieState?.updated_at ? (
            <span className="muted">更新于 {formatCookieUpdatedAt(cookieState.updated_at)}</span>
          ) : null}
        </div>
        <p className="muted">从浏览器的扩展或开发者工具导出贴吧 Cookie 后粘贴。内容只提交到整理服务，不会写进本机存储。</p>
        {cookieFailure ? (
          <div className="banner" role="alert">
            <div>
              <strong>{cookieFailure.hint}</strong>
              <div className="muted">{cookieFailure.code}</div>
            </div>
            {cookieFailure.retry ? (
              <button type="button" onClick={retryCookie} disabled={cookieBusy.length > 0}>重试</button>
            ) : null}
          </div>
        ) : null}
        <form
          className="editor"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            submitCookie()
          }}
        >
          <label>
            格式
            <select
              value={cookieFormat}
              onChange={(event) => setCookieFormat(event.target.value === 'json' ? 'json' : 'netscape')}
            >
              <option value="netscape">netscape</option>
              <option value="json">json</option>
            </select>
          </label>
          <label>
            粘贴
            <textarea
              className="cookie-box"
              value={cookieText}
              onChange={(event) => setCookieText(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              rows={8}
            />
          </label>
          <div className="editor-actions">
            <button type="submit" className="solid" disabled={cookieBusy.length > 0}>
              {cookieBusy === 'put' ? '正在导入…' : '导入 Cookie'}
            </button>
            <button type="button" className="danger" onClick={clearCookie} disabled={cookieBusy.length > 0}>
              {cookieBusy === 'delete' ? '正在清除…' : '清除 Cookie'}
            </button>
          </div>
        </form>
      </section>

      {failure ? (
        <div className="banner" role="alert">
          <div>
            <strong>{failure.hint}</strong>
            <div className="muted">{failure.code}</div>
          </div>
          {failure.retry ? (
            <button type="button" onClick={() => failure.retry?.()} disabled={busy.length > 0}>重试</button>
          ) : null}
        </div>
      ) : null}

      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault()
          submitUrl()
        }}
      >
        <h3>链接取帖</h3>
        <label>
          帖子链接
          <input
            value={url}
            placeholder="https://tieba.baidu.com/p/..."
            onChange={(event) => setUrl(event.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="editor-actions">
          <button type="submit" className="solid" disabled={busy.length > 0}>
            {busy.length > 0 && busy === url.trim() ? '正在取帖…' : '取帖入库'}
          </button>
        </div>
      </form>

      <form
        className="editor scan-form"
        onSubmit={(event) => {
          event.preventDefault()
          submitScan()
        }}
      >
        <h3>时段扫描</h3>
        <p className="muted">时间按上海时区提交，格式带 +08:00。这一步不落库。</p>
        <div className="split">
          <label>
            吧名
            <input value={bar} onChange={(event) => setBar(event.target.value)} />
          </label>
          <label>
            条数上限
            <input
              inputMode="numeric"
              value={limitText}
              onChange={(event) => setLimitText(event.target.value)}
            />
          </label>
        </div>
        <div className="split">
          <label>
            开始
            <input type="datetime-local" value={sinceLocal} onChange={(event) => setSinceLocal(event.target.value)} />
          </label>
          <label>
            结束
            <input type="datetime-local" value={untilLocal} onChange={(event) => setUntilLocal(event.target.value)} />
          </label>
        </div>
        <div className="editor-actions">
          <button type="submit" disabled={busy.length > 0}>{busy === 'scan' ? '正在扫描…' : '扫描候选'}</button>
        </div>
      </form>

      {scanned && candidates.length === 0 ? (
        <div className="empty">
          <h3>这个时段没有候选</h3>
          <p>可以放宽时间，或换一个吧名再扫。</p>
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="table-wrap">
          <table className="candidate-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>时间</th>
                <th>分</th>
                <th>理由</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.url}>
                  <td>
                    <strong>{candidate.title || '（无标题）'}</strong>
                    <div className="muted candidate-url">{candidate.url}</div>
                  </td>
                  <td>{formatDateTime(candidate.posted_at)}</td>
                  <td className="score">{candidate.score}</td>
                  <td>{candidate.reasons.length > 0 ? candidate.reasons.join('；') : '没有给出理由'}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy.length > 0}
                      onClick={() => importCandidate(candidate.url)}
                    >
                      {busy === candidate.url ? '正在入库…' : '入库'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
