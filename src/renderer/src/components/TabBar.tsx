import { useState } from 'react'
import type { PaneLayout, TabState, TabStatus, WidgetKind } from '../../../shared/types'
import { LayoutPicker } from './PaneGrid'
import {
  IconBoard,
  IconChat,
  IconCommand,
  IconGitBranch,
  IconHistory,
  IconMoon,
  IconPlus,
  IconPulse,
  IconSearch,
  IconSliders,
  IconStore,
  IconSun,
  IconTasks,
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
  onAddWidget: (kind: WidgetKind) => void
  onToggleStore: () => void
}

/** Galería de widgets del botón «+ Widget» (rediseño 2a) */
const WIDGET_GALLERY: { kind: WidgetKind; icon: React.JSX.Element; name: string; desc: string }[] = [
  { kind: 'git', icon: <IconGitBranch size={15} />, name: 'Git', desc: 'grafo de ramas' },
  { kind: 'board', icon: <IconBoard size={15} />, name: 'Sprint', desc: 'Azure DevOps' },
  { kind: 'health', icon: <IconPulse size={15} />, name: 'Salud', desc: 'contexto y costo' },
  { kind: 'agents', icon: <IconTasks size={15} />, name: 'Actividad', desc: 'subagentes y plan' }
]

export function TabBar(p: Props): React.JSX.Element {
  const [theme, setTheme] = useState(localStorage.getItem('deck-theme') ?? 'light')
  const [gallery, setGallery] = useState(false)
  const [menu, setMenu] = useState(false)

  const toggleTheme = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('deck-theme', next)
    if (next === 'dark') document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
  }

  const closeMenus = (): void => {
    setGallery(false)
    setMenu(false)
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {p.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === p.activeId ? 'active' : ''} ${tab.mode !== 'chat' ? 'term' : ''}`}
            onClick={() => p.onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) p.onClose(tab.id)
            }}
            title={tab.cwd}
          >
            <span className="tab-kind">
              {tab.mode === 'chat' ? <IconChat size={12} /> : <IconTerminal size={12} />}
            </span>
            <span className="title">{tab.title}</span>
            <span className={`dot ${p.statuses[tab.id] ?? 'idle'}`} />
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
        <button className="tab-new" onClick={p.onNew} title="Nueva pestaña (Ctrl+Shift+T)">
          <IconPlus size={14} />
        </button>
      </div>
      <div className="actions">
        <div className="menu-anchor">
          <button
            className={`iconbtn iconlabel ${gallery ? 'open' : ''}`}
            onClick={() => {
              setMenu(false)
              setGallery((v) => !v)
            }}
            title="Agregar un widget a los laterales del chat activo"
          >
            <IconPlus size={12} /> Widget <span className="caret">▾</span>
          </button>
          {gallery && (
            <>
              <div className="menu-backdrop" onMouseDown={closeMenus} />
              <div className="dropdown widget-gallery">
                <div className="dropdown-head">
                  <b>Galería de widgets</b>
                  <span className="hint" style={{ margin: 0 }}>
                    se agregan al chat activo; arrástralos entre laterales
                  </span>
                </div>
                <div className="gallery-grid">
                  {WIDGET_GALLERY.map((w) => (
                    <div
                      key={w.kind}
                      className="gallery-item"
                      onClick={() => {
                        p.onAddWidget(w.kind)
                        closeMenus()
                      }}
                    >
                      <span className="gallery-icon">{w.icon}</span>
                      <b>{w.name}</b>
                      <span>{w.desc}</span>
                    </div>
                  ))}
                </div>
                <div
                  className="dropdown-foot"
                  onClick={() => {
                    p.onToggleStore()
                    closeMenus()
                  }}
                >
                  <IconStore size={12} /> Más en la Tienda →
                </div>
              </div>
            </>
          )}
        </div>
        <button className="iconbtn iconlabel" onClick={p.onSearch} title="Buscar en todos los chats (Ctrl+Shift+F)">
          <IconSearch size={13} /> Buscar
        </button>
        <LayoutPicker layout={p.wsLayout} onChange={p.onWsLayout} title="Dividir la vista en 2 o 4 chats" />
        <button className="iconbtn" onClick={toggleTheme} title="Cambiar tema claro/oscuro">
          {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
        </button>
        <div className="menu-anchor">
          <button
            className={`iconbtn ${menu ? 'open' : ''}`}
            onClick={() => {
              setGallery(false)
              setMenu((v) => !v)
            }}
            title="Más acciones"
          >
            ⋯
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onMouseDown={closeMenus} />
              <div className="dropdown overflow-menu">
                <div
                  className="menu-item"
                  onClick={() => {
                    p.onToggleSessions()
                    closeMenus()
                  }}
                >
                  <IconHistory size={13} /> Historial de sesiones <kbd>⌃⇧H</kbd>
                </div>
                <div
                  className="menu-item"
                  onClick={() => {
                    p.onPalette()
                    closeMenus()
                  }}
                >
                  <IconCommand size={13} /> Paleta de comandos <kbd>⌃⇧P</kbd>
                </div>
                <div
                  className="menu-item"
                  onClick={() => {
                    p.onToggleConfig()
                    closeMenus()
                  }}
                >
                  <IconSliders size={13} /> Configuración <kbd>⌃⇧G</kbd>
                </div>
                <div
                  className="menu-item"
                  onClick={() => {
                    p.onToggleStore()
                    closeMenus()
                  }}
                >
                  <IconStore size={13} /> Tienda
                </div>
                <div className="menu-sep" />
                <div
                  className="menu-item"
                  onClick={() => {
                    toggleTheme()
                    closeMenus()
                  }}
                >
                  {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />} Tema:{' '}
                  {theme === 'dark' ? 'oscuro' : 'claro'}
                  <span className="hint" style={{ margin: '0 0 0 auto' }}>
                    cambiar
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
