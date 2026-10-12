import { useEffect, useState } from 'react'
import { deckExtra, type RewindResult } from './deckExtra'

type Phase =
  | { kind: 'checking' }
  | { kind: 'preview'; r: RewindResult }
  | { kind: 'running'; r: RewindResult }
  | { kind: 'done'; r: RewindResult }
  | { kind: 'error'; message: string }

function Stats(p: { r: RewindResult }): React.JSX.Element {
  const files = p.r.filesChanged ?? []
  return (
    <>
      <div className="rewind-stats">
        <span>
          {files.length} archivo{files.length === 1 ? '' : 's'}
        </span>
        <span className="rewind-ins">+{p.r.insertions ?? 0}</span>
        <span className="rewind-del">−{p.r.deletions ?? 0}</span>
      </div>
      {files.length > 0 && (
        <div className="rewind-files">
          {files.map((f) => (
            <div key={f} className="cd-row">
              <span className="msg mono" title={f}>
                {f}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Rebobinado de archivos hasta un mensaje del usuario: primero un ensayo
 * (dry-run) que enseña qué se tocaría, y solo con confirmación el real.
 * Solo revierte archivos: la conversación sigue intacta.
 */
export function RewindDialog(p: {
  tabId: string
  messageId: string
  preview: string
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const api = deckExtra().chatRewindFiles

  useEffect(() => {
    if (!api) {
      setPhase({ kind: 'error', message: 'No disponible: esta versión de la app no sabe rebobinar archivos.' })
      return
    }
    let alive = true
    api(p.tabId, p.messageId, true)
      .then((r) => {
        if (!alive) return
        if (!r.canRewind) setPhase({ kind: 'error', message: r.error || 'No se puede rebobinar hasta este mensaje.' })
        else setPhase({ kind: 'preview', r })
      })
      .catch((e: unknown) => alive && setPhase({ kind: 'error', message: String(e) }))
    return () => {
      alive = false
    }
  }, [api, p.tabId, p.messageId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // sin esto, el Esc llegaría también al atajo de la vista que detiene a Claude
      e.stopImmediatePropagation()
      p.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p])

  const run = (): void => {
    if (!api || phase.kind !== 'preview') return
    setPhase({ kind: 'running', r: phase.r })
    api(p.tabId, p.messageId, false)
      .then((r) => {
        if (!r.canRewind) setPhase({ kind: 'error', message: r.error || 'El rebobinado falló.' })
        else setPhase({ kind: 'done', r })
      })
      .catch((e: unknown) => setPhase({ kind: 'error', message: String(e) }))
  }

  const nothing =
    phase.kind === 'preview' && (phase.r.filesChanged ?? []).length === 0

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="cd-dialog rewind-dialog" role="dialog" aria-modal="true">
        <div className="cd-dialog__head">
          <span className="cd-dialog__icon">⟲</span>
          <span className="cd-dialog__title">Rebobinar archivos hasta aquí</span>
          <button className="cd-dialog__close" style={{ marginLeft: 'auto' }} onClick={p.onClose} title="Cerrar (Esc)">
            ✕
          </button>
        </div>
        <div className="cd-dialog__body">
          <div className="rewind-quote">{p.preview}</div>
          {phase.kind === 'checking' && (
            <p className="cd-help">
              <span className="spinner" /> Calculando qué archivos cambiarían…
            </p>
          )}
          {phase.kind === 'error' && <div className="cd-err">{phase.message}</div>}
          {(phase.kind === 'preview' || phase.kind === 'running') && (
            <>
              <p className="cd-help">
                {nothing
                  ? 'No hay cambios de archivos que deshacer desde este mensaje.'
                  : 'Los archivos volverán al estado que tenían al enviar este mensaje. La conversación no se modifica.'}
              </p>
              <Stats r={phase.r} />
            </>
          )}
          {phase.kind === 'done' && (
            <>
              <p className="cd-help">✓ Archivos rebobinados.</p>
              <Stats r={phase.r} />
            </>
          )}
        </div>
        <div className="cd-dialog__foot">
          <span style={{ flex: 1 }} />
          {phase.kind === 'done' || phase.kind === 'error' ? (
            <button className="cd-btn cd-btn--primary" onClick={p.onClose} autoFocus>
              Cerrar
            </button>
          ) : (
            <>
              <button className="cd-btn cd-btn--ghost" onClick={p.onClose}>
                Cancelar
              </button>
              <button
                className="cd-btn cd-btn--danger"
                disabled={phase.kind !== 'preview' || nothing}
                onClick={run}
              >
                {phase.kind === 'running' ? 'Rebobinando…' : 'Rebobinar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
