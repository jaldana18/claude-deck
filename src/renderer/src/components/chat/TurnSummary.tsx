import { memo, useState } from 'react'
import { labelFor } from '../../../../shared/models'
import { formatDuration, formatFullTime, formatMessageTime } from '../../../../shared/messageTime'
import { IconAlertCircle, IconCheck, IconChevronRight, IconFilePlus, IconPencil } from '../Icons'
import { formatCost, relPath, type FileChange } from './logic'

function modelsLabel(models?: string[]): string {
  if (!models || models.length === 0) return ''
  return [...new Set(models.map((m) => labelFor(m)))].join(', ')
}

/** Barra compacta al final de un turno: archivos tocados, tests, tiempo, coste, modelo */
export const TurnSummary = memo(function TurnSummary(p: {
  changes: FileChange[]
  tests?: 'pass' | 'fail' | null
  durationMs?: number
  costUsd?: number
  models?: string[]
  /** cwd opcional para mostrar rutas relativas en la lista */
  cwd?: string
  onOpenPath: (p: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const n = p.changes.length
  const added = p.changes.reduce((a, c) => a + c.added, 0)
  const removed = p.changes.reduce((a, c) => a + c.removed, 0)
  const dur = p.durationMs !== undefined && p.durationMs > 0 ? formatDuration(p.durationMs) : ''
  const cost = formatCost(p.costUsd)
  const model = modelsLabel(p.models)
  if (!n && !p.tests && !dur && !cost && !model) return null

  const parts: React.ReactNode[] = []
  if (n)
    parts.push(
      <span key="f">
        {n} {n === 1 ? 'archivo' : 'archivos'}
      </span>,
      <span key="d" className="cr-stat">
        <span className="cr-add">+{added}</span> <span className="cr-del">−{removed}</span>
      </span>
    )
  if (p.tests === 'pass')
    parts.push(
      <span key="t" className="cr-tests cr-tests--ok">
        tests <IconCheck size={11} />
      </span>
    )
  if (p.tests === 'fail')
    parts.push(
      <span key="t" className="cr-tests cr-tests--err">
        tests <IconAlertCircle size={11} />
      </span>
    )
  if (dur) parts.push(<span key="du">{dur}</span>)
  if (cost) parts.push(<span key="c">{cost}</span>)
  if (model) parts.push(<span key="m">{model}</span>)

  return (
    <div className="cr-summary">
      <button
        type="button"
        className="cr-summary-bar"
        aria-expanded={n ? open : undefined}
        disabled={!n}
        onClick={() => setOpen((o) => !o)}
      >
        {n > 0 && <IconChevronRight size={11} className={`cr-chev${open ? ' open' : ''}`} />}
        {parts.map((x, i) => (
          <span key={i} className="cr-summary-part">
            {i > 0 && <span className="cr-sep">·</span>}
            {x}
          </span>
        ))}
      </button>
      {open && n > 0 && (
        <div className="cr-summary-list">
          {p.changes.map((c) => (
            <button
              key={c.path}
              type="button"
              className="cr-summary-file"
              title={`Abrir ${c.path}`}
              onClick={() => p.onOpenPath(c.path)}
            >
              {c.kind === 'write' ? <IconFilePlus size={12} /> : <IconPencil size={12} />}
              <span className="cr-summary-path">{relPath(c.path, p.cwd ?? '')}</span>
              <span className="cr-stat">
                <span className="cr-add">+{c.added}</span> <span className="cr-del">−{c.removed}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

/** Separador fino entre turnos con hora · duración · coste · modelo */
export const TurnSeparator = memo(function TurnSeparator(p: {
  /** ISO de la marca de tiempo del turno */
  timestamp?: string
  durationMs?: number
  costUsd?: number
  models?: string[]
  /** texto libre que se añade al final */
  label?: string
}): React.JSX.Element {
  const parts = [
    formatMessageTime(p.timestamp),
    p.durationMs !== undefined && p.durationMs > 0 ? formatDuration(p.durationMs) : '',
    formatCost(p.costUsd),
    modelsLabel(p.models),
    p.label ?? ''
  ].filter(Boolean)
  return (
    <div className="cr-turnsep" role="separator" title={formatFullTime(p.timestamp) || undefined}>
      {parts.length > 0 && <span className="cr-turnsep-text">{parts.join(' · ')}</span>}
    </div>
  )
})
