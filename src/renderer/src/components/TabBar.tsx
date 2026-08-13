import { useState } from 'react'
import type { PaneLayout, TabState, TabStatus } from '../../../shared/types'
import { LayoutPicker } from './PaneGrid'
import {
  IconBoard,
  IconChat,
  IconCommand,
  IconGitBranch,
  IconHistory,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSliders,
  IconSun,
  IconTerminal,
  IconX
} from './Icons'

interface Props {
  tabs: TabState[]
  activeId: string | null
  statuses: Record<string, TabStatus>
  wsLayout: PaneLayout
  onWsLayout: (l: PaneLayout) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onSearch: () => void
  onPalette: () => void
  onToggleConfig: () => void
  onToggleSessions: () => void
  onToggleGit: () => void
  onToggleBoard: () => void
}

export function TabBar(p: Props): React.JSX.Element {
  const [theme, setTheme] = useState(localStorage.getItem('deck-theme') ?? 'dark')

  const toggleTheme = (): void => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('deck-theme', next)
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {p.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === p.activeId ? 'active' : ''}`}
            onClick={() => p.onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) p.onClose(tab.id)
            }}
            title={tab.cwd}
          >
            <span className={`dot ${p.statuses[tab.id] ?? 'idle'}`} />
            <span className="tab-kind">
              {tab.mode === 'chat' ? <IconChat size={12} /> : <IconTerminal size={12} />}
            </span>
            <span className="title">{tab.title}</span>
            <button
              className="close"
              title="Cerrar pestaña (la sesión de Claude sigue guardada)"
              onClick={(e) => {
                e.stopPropagation()
                p.onClose(tab.id)
              }}
            >
              <IconX size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="iconbtn primary" onClick={p.onNew} title="Nueva pestaña (Ctrl+Shift+T)">
          <IconPlus size={14} />
        </button>
        <span className="actions-sep" />
        <LayoutPicker layout={p.wsLayout} onChange={p.onWsLayout} title="Dividir la vista en 2 o 4 chats" />
        <span className="actions-sep" />
        <button className="iconbtn" onClick={p.onToggleSessions} title="Historial de sesiones (Ctrl+Shift+H)">
          <IconHistory size={14} />
        </button>
        <button className="iconbtn" onClick={p.onToggleGit} title="Agregar widget de git (puedes tener varios, uno por repo)">
          <IconGitBranch size={14} />
        </button>
        <button className="iconbtn" onClick={p.onToggleBoard} title="Agregar widget de sprint (puedes tener varios)">
          <IconBoard size={14} />
        </button>
        <button className="iconbtn" onClick={p.onSearch} title="Buscar en chats (Ctrl+Shift+F)">
          <IconSearch size={14} />
        </button>
        <button className="iconbtn" onClick={p.onPalette} title="Paleta de comandos (Ctrl+Shift+P)">
          <IconCommand size={14} />
        </button>
        <button className="iconbtn" onClick={p.onToggleConfig} title="Configuración del proyecto (Ctrl+Shift+G)">
          <IconSliders size={14} />
        </button>
        <button className="iconbtn" onClick={toggleTheme} title="Cambiar tema claro/oscuro">
          {theme === 'light' ? <IconMoon size={14} /> : <IconSun size={14} />}
        </button>
      </div>
    </div>
  )
}
