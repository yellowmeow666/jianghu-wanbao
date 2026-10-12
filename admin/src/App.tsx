import { useState } from 'react'
import { SettingsBar } from './components/SettingsBar.tsx'
import { CardEditor } from './screens/CardEditor.tsx'
import { CardList } from './screens/CardList.tsx'
import { TiebaIngest } from './screens/TiebaIngest.tsx'
import type { Card } from './types.ts'

type Screen =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'tieba' }
  | { kind: 'edit'; card: Card; back: 'list' | 'tieba'; note: string }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [reloadToken, setReloadToken] = useState(0)

  function backToList() {
    setScreen({ kind: 'list' })
    setReloadToken((value) => value + 1)
  }

  return (
    <div className="app">
      <header className="masthead">
        <p className="kicker">整理台</p>
        <h1>江湖晚报</h1>
        <p>内部录入。读者端只看已发布条目，这里的文字不是对外通报。</p>
        <nav className="nav">
          <button
            type="button"
            className={screen.kind === 'tieba' ? 'ghost' : 'solid'}
            onClick={() => {
              setScreen({ kind: 'list' })
              setReloadToken((value) => value + 1)
            }}
          >
            条目
          </button>
          <button
            type="button"
            className={screen.kind === 'tieba' ? 'solid' : 'ghost'}
            onClick={() => setScreen({ kind: 'tieba' })}
          >
            贴吧取帖
          </button>
        </nav>
      </header>
      <SettingsBar onSaved={() => setReloadToken((value) => value + 1)} />
      {screen.kind === 'list' ? (
        <CardList
          reloadToken={reloadToken}
          onCreate={() => setScreen({ kind: 'create' })}
          onEdit={(card) => setScreen({ kind: 'edit', card, back: 'list', note: '' })}
        />
      ) : null}
      {screen.kind === 'tieba' ? (
        <TiebaIngest onOpenCard={(card, note) => setScreen({ kind: 'edit', card, back: 'tieba', note })} />
      ) : null}
      {screen.kind === 'create' || screen.kind === 'edit' ? (
        <CardEditor
          card={screen.kind === 'edit' ? screen.card : null}
          arrivalNote={screen.kind === 'edit' ? screen.note : ''}
          cancelLabel={screen.kind === 'edit' && screen.back === 'tieba' ? '返回取帖' : '返回列表'}
          onCancel={() => {
            if (screen.kind === 'edit' && screen.back === 'tieba') {
              setScreen({ kind: 'tieba' })
              return
            }
            backToList()
          }}
          onSaved={(card) => {
            const back = screen.kind === 'edit' ? screen.back : 'list'
            setScreen({ kind: 'edit', card, back, note: '' })
          }}
        />
      ) : null}
    </div>
  )
}
