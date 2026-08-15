import { useRef, useState } from 'react'
import type { PaneLayout, TabState, TabStatus, WidgetKind, WidgetSide } from '../../../shared/types'
import { LayoutPicker } from './PaneGrid'
import {
  IconBoard,
  IconBook,
  IconChat,
  IconClock,
  IconClipboard,
  IconCommand,
  IconDiffStats,
  IconFolderTree,
  IconGitBranch,
  IconHistory,
  IconMoon,
  IconPlay,
  IconPlus,
  IconPr,
  IconPulse,
  IconSearch,
  IconSliders,
  IconStore,
  IconTune,
  IconSun,
  IconTasks,
  IconTerminal,
  IconTerminalLog,
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
  onAddWidget: (kind: WidgetKind, side?: WidgetSide) => void
  onToggleStore: () => void
  onToggleSettings: () => void
}

/** Galería de widgets del botón «+ Widget» (rediseño 2a) */
const WIDGET_GALLERY: { kind: WidgetKind; icon: React.JSX.Element; name: string; desc: string }[] = [
  { kind: 'git', icon: <IconGitBranch size={15} />, name: 'Git', desc: 'grafo de ramas' },
  { kind: 'board', icon: <IconBoard size={15} />, name: 'Sprint', desc: 'Azure DevOps' },
  { kind: 'health', icon: <IconPulse size={15} />, name: 'Salud', desc: 'contexto y costo' },
  { kind: 'agents', icon: <IconTasks size={15} />, name: 'Actividad', desc: 'subagentes en vivo' },
  { kind: 'tasks', icon: <IconTasks size={15} />, name: 'Tareas', desc: 'plan de Claude' },
  { kind: 'ci', icon: <IconPlay size={15} />, name: 'Pipelines', desc: 'builds del repo' },
  { kind: 'prs', icon: <IconPr size={15} />, name: 'Pull requests', desc: 'PRs abiertos' },
  { kind: 'notes', icon: <IconBook size={15} />, name: 'Notas', desc: 'bloc por pestaña' },
  { kind: 'timer', icon: <IconClock size={15} />, name: 'Sesión', desc: 'tiempo y costo' },
  { kind: 'clipboard', icon: <IconClipboard size={15} />, name: 'Portapapeles', desc: 'historial de copias' },
  { kind: 'logs', icon: <IconTerminalLog size={15} />, name: 'Logs', desc: 'salida de procesos' },
  { kind: 'files', icon: <IconFolderTree size={15} />, name: 'Archivos', desc: 'explorador con git' },
  { kind: 'diffstats', icon: <IconDiffStats size={15} />, name: 'Diff Stats', desc: 'cambios del repo' }
]

export function TabBar(p: Props): React.JSX.Element {
  const [theme, setTheme] = useState(localStorage.getItem('deck-theme') ?? 'light')
  const [gallery, setGallery] = useState(false)
  const [menu, setMenu] = useState(false)

  /**
   * Snap de pestañas (mockup 2b): arrastrar una pestaña hacia el área de
   * trabajo emite eventos deck:tabdrag que App usa para mostrar la vista
   * previa de mitad y el selector de layouts, y dividir al soltar.
   */
  const startTabDrag = (e: React.PointerEvent, tabId: string, title: string): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.close')) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    let ghost: HTMLDivElement | null = null
    const fire = (phase: string, x = 0, y = 0): void => {
      window.dispatchEvent(new CustomEvent('deck:tabdrag', { detail: { phase, tabId, x, y } }))
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      ghost?.remove()
    }
    const onMove = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        ghost = document.createElement('div')
        ghost.className = 'deck-widget-ghost'
        ghost.textContent = `◨ ${title}`
        document.body.appendChild(ghost)
        fire('start', ev.clientX, ev.clientY)
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 10}px`
        ghost.style.top = `${ev.clientY + 10}px`
      }
      fire('move', ev.clientX, ev.clientY)
    }
    const onUp = (ev: PointerEvent): void => {
      const wasDrag = started
      cleanup()
      if (wasDrag) fire('drop', ev.clientX, ev.clientY)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        cleanup()
        fire('cancel')
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

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

  // evita que el click posterior a un drag de la galería agregue el widget dos veces
  const galleryDragged = useRef(false)

  /**
   * Drag&drop desde la galería (mockup 2a): arrastrar la tarjeta hacia un
   * lateral del chat crea el widget en ese lado; las dropzones aparecen con
   * body.cd-drag-active. Clic simple sigue agregando al lado por defecto.
   */
  const startGalleryDrag = (e: React.PointerEvent, kind: WidgetKind, name: string): void => {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    let ghost: HTMLDivElement | null = null
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('cd-drag-active')
      ghost?.remove()
    }
    const onMove = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        galleryDragged.current = true
        setGallery(false)
        document.body.classList.add('cd-drag-active')
        ghost = document.createElement('div')
        ghost.className = 'deck-widget-ghost'
        ghost.textContent = `⠿ ${name}`
        document.body.appendChild(ghost)
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 10}px`
        ghost.style.top = `${ev.clientY + 10}px`
      }
    }
    const onUp = (ev: PointerEvent): void => {
      const wasDrag = started
      cleanup()
      if (!wasDrag) return
      const dock = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((el) => (el as HTMLElement).dataset?.dockSide) as HTMLElement | undefined
      if (dock) {
        p.onAddWidget(kind, dock.dataset.dockSide as WidgetSide)
        closeMenus()
      }
      // liberar la supresión del click en el siguiente tick
      setTimeout(() => (galleryDragged.current = false), 0)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        cleanup()
        setTimeout(() => (galleryDragged.current = false), 0)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {p.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === p.activeId ? 'active' : ''} ${tab.mode !== 'chat' ? 'term' : ''}`}
            onClick={() => p.onActivate(tab.id)}
            onPointerDown={(e) => startTabDrag(e, tab.id, tab.title)}
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
                      title="Clic para agregar, o arrástrala hacia un lateral del chat"
                      onPointerDown={(e) => startGalleryDrag(e, w.kind, w.name)}
                      onClick={() => {
                        if (galleryDragged.current) return
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
                <div
                  className="menu-item"
                  onClick={() => {
                    p.onToggleSettings()
                    closeMenus()
                  }}
                >
                  <IconTune size={13} /> Ajustes de la app
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
