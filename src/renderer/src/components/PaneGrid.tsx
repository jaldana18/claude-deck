import type { PaneLayout, TabState } from '../../../shared/types'
import { paneIdsFor } from '../../../shared/types'
import { TerminalView } from './TerminalView'

interface GridProps {
  tab: TabState
  visible: boolean
  exitedPanes: Record<string, boolean>
  onRestartPane: (paneId: string) => void
  /** etiqueta del botón de reinicio del panel principal */
  mainRestartLabel?: string
  /** estilo VS Code: mostrar SOLO esta instancia (las demás siguen montadas) */
  solo?: string | null
}

const GRID_STYLE: Record<PaneLayout, React.CSSProperties> = {
  single: { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' },
  cols: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' },
  rows: { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' },
  grid: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
}

/** Cuadrícula de terminales de una pestaña (split estilo Windows Snap) */
export function PaneGrid(p: GridProps): React.JSX.Element {
  const layout = p.tab.paneLayout ?? 'single'
  const panes = paneIdsFor(p.tab.id, layout)
  const solo = p.solo && panes.includes(p.solo) ? p.solo : null
  return (
    <div className="pane-grid" style={GRID_STYLE[solo ? 'single' : layout]}>
      {panes.map((paneId) => (
        <div
          key={paneId}
          className="pane-cell"
          style={solo && solo !== paneId ? { display: 'none' } : undefined}
        >
          <TerminalView
            paneId={paneId}
            visible={p.visible && (!solo || solo === paneId)}
            exited={Boolean(p.exitedPanes[paneId])}
            restartLabel={
              paneId === p.tab.id ? (p.mainRestartLabel ?? 'Relanzar') : 'Relanzar shell'
            }
            onRestart={() => p.onRestartPane(paneId)}
          />
        </div>
      ))}
    </div>
  )
}

interface PickerProps {
  layout: PaneLayout
  onChange: (layout: PaneLayout) => void
  title?: string
}

const LAYOUTS: { id: PaneLayout; icon: string; title: string }[] = [
  { id: 'single', icon: '▭', title: 'Un panel' },
  { id: 'cols', icon: '◫', title: 'Dos columnas' },
  { id: 'rows', icon: '⬒', title: 'Dos filas' },
  { id: 'grid', icon: '⊞', title: 'Cuadrícula 2x2' }
]

/** Selector de distribución de paneles */
export function LayoutPicker(p: PickerProps): React.JSX.Element {
  return (
    <div className="layout-picker" title={p.title}>
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          className={`layout-btn ${p.layout === l.id ? 'sel' : ''}`}
          title={p.title ? `${p.title}: ${l.title.toLowerCase()}` : l.title}
          onClick={() => p.onChange(l.id)}
        >
          {l.icon}
        </button>
      ))}
    </div>
  )
}
