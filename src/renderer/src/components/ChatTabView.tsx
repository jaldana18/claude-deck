import { memo, useEffect, useRef, useState } from 'react'
import type { PaneLayout, ShellId, TabState, WidgetState } from '../../../shared/types'
import { paneIdsFor } from '../../../shared/types'
import { ChatView } from './ChatView'
import { LayoutPicker, PaneGrid } from './PaneGrid'

interface Props {
  tab: TabState
  visible: boolean
  exitedPanes: Record<string, boolean>
  widgets: WidgetState[]
  onWidgetsChange: (tabId: string, widgets: WidgetState[]) => void
  onRestartPane: (paneId: string) => void
  onLayoutChange: (tab: TabState) => void
}

/**
 * Pestaña en modo chat: ChatView arriba + terminal PowerShell colapsable abajo
 * (estilo VS Code) divisible en 2-4 paneles. Ctrl+` alterna el terminal.
 * Memoizada: los re-renders de App (estados de otras pestañas) no la tocan.
 */
export const ChatTabView = memo(function ChatTabView(p: Props): React.JSX.Element {
  const [showTerm, setShowTerm] = useState(false)
  const [termHeight, setTermHeight] = useState(280)
  const [shell, setShell] = useState<ShellId>('powershell')
  const dragging = useRef(false)

  useEffect(() => {
    void window.deck.getProjectPrefs(p.tab.cwd).then((prefs) => setShell(prefs.shell ?? 'powershell'))
  }, [p.tab.cwd])

  /** Selector de shell (kit §7): persiste por proyecto y relanza los paneles.
   *  Usa onRestartPane (de App) para que también limpie el estado «terminó». */
  const changeShell = async (next: ShellId): Promise<void> => {
    setShell(next)
    const prefs = await window.deck.getProjectPrefs(p.tab.cwd)
    await window.deck.setProjectPrefs(p.tab.cwd, { ...prefs, shell: next })
    for (const paneId of paneIdsFor(p.tab.id, p.tab.paneLayout)) {
      p.onRestartPane(paneId)
    }
  }

  useEffect(() => {
    if (!p.visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.code === 'Backquote') {
        e.preventDefault()
        setShowTerm((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.visible])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      setTermHeight((h) => Math.min(window.innerHeight - 220, Math.max(140, h - e.movementY)))
    }
    const onUp = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Estilo VS Code: lista de instancias a la derecha; clic muestra esa sola,
  // el selector de layouts hace de «split», + agrega terminal, × cierra la última
  const [solo, setSolo] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const heightBefore = useRef(280)

  const setLayout = async (layout: PaneLayout): Promise<void> => {
    const updated = await window.deck.setPaneLayout(p.tab.id, layout)
    if (updated) p.onLayoutChange(updated)
    if (layout !== 'single') setShowTerm(true)
    setSolo(null)
  }

  const paneIds = paneIdsFor(p.tab.id, p.tab.paneLayout)

  const addTerminal = async (): Promise<void> => {
    const next: PaneLayout = paneIds.length === 1 ? 'cols' : 'grid'
    if (paneIds.length >= 4) return
    const updated = await window.deck.setPaneLayout(p.tab.id, next)
    if (updated) {
      p.onLayoutChange(updated)
      setShowTerm(true)
      // mostrar la instancia nueva sola, como hace VS Code al crear terminal
      setSolo(paneIdsFor(p.tab.id, next).at(-1) ?? null)
    }
  }

  const closeLast = async (): Promise<void> => {
    const prev: PaneLayout = paneIds.length > 2 ? 'cols' : 'single'
    const updated = await window.deck.setPaneLayout(p.tab.id, prev)
    if (updated) {
      p.onLayoutChange(updated)
      setSolo(null)
    }
  }

  const toggleMaximize = (): void => {
    if (maximized) {
      setTermHeight(heightBefore.current)
    } else {
      heightBefore.current = termHeight
      setTermHeight(Math.max(300, window.innerHeight - 160))
      setShowTerm(true)
    }
    setMaximized((v) => !v)
  }

  return (
    <div className="chat-tab" style={{ display: p.visible ? 'flex' : 'none' }}>
      <ChatView
        tab={p.tab}
        visible={p.visible}
        widgets={p.widgets}
        onWidgetsChange={(next) => p.onWidgetsChange(p.tab.id, next)}
      />
      <div className="term-panel" style={{ height: showTerm ? termHeight : 30 }}>
        <div
          className="term-panel-head"
          onMouseDown={(e) => {
            if (showTerm && (e.target as HTMLElement).tagName !== 'BUTTON') {
              dragging.current = true
              document.body.style.cursor = 'ns-resize'
              e.preventDefault()
            }
          }}
          onDoubleClick={() => setShowTerm((v) => !v)}
        >
          <button className="term-toggle" onClick={() => setShowTerm((v) => !v)}>
            {showTerm ? '▾' : '▴'} TERMINAL <kbd>Ctrl+`</kbd>
          </button>
          <LayoutPicker layout={p.tab.paneLayout ?? 'single'} onChange={(l) => void setLayout(l)} />
          <select
            className="cd-shell-select"
            value={shell}
            onChange={(e) => void changeShell(e.target.value as ShellId)}
            onMouseDown={(e) => e.stopPropagation()}
            title="Shell de los paneles de este proyecto (relanza los terminales)"
          >
            <option value="powershell">PowerShell</option>
            <option value="cmd">CMD</option>
            <option value="bash">Bash</option>
          </select>
          <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.tab.cwd}
          </span>
          <span style={{ flex: 1 }} />
          {/* lista de instancias estilo VS Code */}
          <span className="term-instances" onMouseDown={(e) => e.stopPropagation()}>
            {paneIds.map((pid, i) => (
              <button
                key={pid}
                className={`term-inst ${
                  paneIds.length === 1 || solo === pid ? 'active' : solo ? '' : 'in-split'
                }`}
                title={solo === pid ? 'Instancia visible' : 'Mostrar solo esta instancia'}
                onClick={() => {
                  setShowTerm(true)
                  setSolo(paneIds.length === 1 ? null : pid)
                }}
              >
                ›_ {shell} {i + 1}
              </button>
            ))}
            {paneIds.length > 1 && (
              <button className="term-inst" title="Cerrar la última instancia" onClick={() => void closeLast()}>
                ×
              </button>
            )}
            <button
              className="term-inst"
              title="Nueva instancia de terminal"
              disabled={paneIds.length >= 4}
              onClick={() => void addTerminal()}
            >
              +
            </button>
            <button
              className="term-inst"
              title={maximized ? 'Restaurar tamaño del panel' : 'Maximizar panel'}
              onClick={toggleMaximize}
            >
              {maximized ? '⌄' : '⌃'}
            </button>
          </span>
        </div>
        {/* Los terminales quedan montados siempre para no perder su estado */}
        <div className="term-panel-body" style={{ display: showTerm ? 'block' : 'none' }}>
          <PaneGrid
            tab={p.tab}
            visible={p.visible && showTerm}
            exitedPanes={p.exitedPanes}
            onRestartPane={p.onRestartPane}
            mainRestartLabel="Relanzar shell"
            solo={solo}
          />
        </div>
      </div>
    </div>
  )
})
