import { memo, useEffect, useRef, useState } from 'react'
import type { PaneLayout, TabState, WidgetState } from '../../../shared/types'
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
  const dragging = useRef(false)

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

  const setLayout = async (layout: PaneLayout): Promise<void> => {
    const updated = await window.deck.setPaneLayout(p.tab.id, layout)
    if (updated) p.onLayoutChange(updated)
    if (layout !== 'single') setShowTerm(true)
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
          <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.tab.cwd}
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
          />
        </div>
      </div>
    </div>
  )
})
