import { useState } from 'react'
import { getAdminCardById, importTiebaUrl, ingestTiebaByUrl, scanTieba } from '../api.ts'
import { formatDateTime } from '../format.ts'
import { ApiError } from '../model.ts'
import {
  DEFAULT_TIEBA_BAR,
  defaultScanWindow,
  explainIngestError,
  localInputToShanghaiIso,
  localTiebaUrlIssue,
} from '../tieba.ts'
import type { TiebaCandidate } from '../tieba.ts'
import type { Card } from '../types.ts'

interface TiebaIngestProps {
  onOpenCard: (card: Card, note: string) => void
}

interface FailureState {
  hint: string
  code: string
  retry: (() => void) | null
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
      setFailure({ hint: urlIssue, code: 'INVALID_BODY', retry: null })
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
