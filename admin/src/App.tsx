import { useState } from 'react'
import { SettingsBar } from './components/SettingsBar.tsx'
import { CardEditor } from './screens/CardEditor.tsx'
import { CardList } from './screens/CardList.tsx'
import type { Card } from './types.ts'

type Screen =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; card: Card }

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
      </header>
      <SettingsBar onSaved={() => setReloadToken((value) => value + 1)} />
      {screen.kind === 'list' ? (
        <CardList
          reloadToken={reloadToken}
          onCreate={() => setScreen({ kind: 'create' })}
          onEdit={(card) => setScreen({ kind: 'edit', card })}
        />
      ) : (
        <CardEditor
          card={screen.kind === 'edit' ? screen.card : null}
          onCancel={backToList}
          onSaved={(card) => setScreen({ kind: 'edit', card })}
        />
      )}
    </div>
  )
}
