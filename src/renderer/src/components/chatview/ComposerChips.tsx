import { useState } from 'react'
import type { ModelOption, PermissionModeId } from '../../../../shared/types'
import { esConocido, modelChipLabel, modelGroups } from './modelOptions'

export const MODE_LABEL: Record<PermissionModeId, string> = {
  default: '🔒 Preguntar',
  acceptEdits: '✏️ Auto-editar',
  bypassPermissions: '⚡ Auto total',
  plan: '📋 Plan'
}

const MODE_DESC: Record<PermissionModeId, string> = {
  default: 'Pide permiso antes de cada acción sensible',
  acceptEdits: 'Aprueba las ediciones de archivos; pregunta lo demás',
  bypassPermissions: 'Aprueba TODO sin preguntar, comandos incluidos',
  plan: 'Solo planifica: no edita ni ejecuta'
}

/** Esc cierra el menú sin llegar al atajo global de la vista (que detiene a Claude) */
function escCloses(e: React.KeyboardEvent, open: boolean, close: () => void): void {
  if (e.key !== 'Escape' || !open) return
  e.stopPropagation()
  close()
}

/** Chip del modo de permisos de la pestaña, con menú hacia arriba */
export function ModeChip(p: {
  mode: PermissionModeId
  disabled?: boolean
  onChange: (mode: PermissionModeId) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="cchip-anchor" onKeyDown={(e) => escCloses(e, open, () => setOpen(false))}>
      <button
        className={`cchip ${p.mode === 'bypassPermissions' ? 'warn' : ''} ${open ? 'open' : ''}`}
        disabled={p.disabled}
        onClick={() => setOpen((o) => !o)}
        title="Modo de permisos de esta pestaña"
      >
        {MODE_LABEL[p.mode]} <span className="cchip-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="cchip-pop cd-pop" role="menu">
            {(Object.keys(MODE_LABEL) as PermissionModeId[]).map((m) => (
              <button
                key={m}
                role="menuitemradio"
                aria-checked={p.mode === m}
                className={`cchip-item ${p.mode === m ? 'sel' : ''}`}
                onClick={() => {
                  setOpen(false)
                  p.onChange(m)
                }}
              >
                <b>{MODE_LABEL[m]}</b>
                <span>{MODE_DESC[m]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

/**
 * Chip del modelo de la sesión. El modelo de respaldo va como sección
 * secundaria del mismo menú: es un ajuste del modelo, no merece otro chip.
 */
export function ModelChip(p: {
  model: string
  autoModel: string
  fallback: string
  models: ModelOption[]
  disabled?: boolean
  onOpen: () => void
  onChange: (model: string) => void
  onFallbackChange: (model: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState<string | null>(null)
  const groups = modelGroups(p.models)
  const close = (): void => {
    setOpen(false)
    setManual(null)
  }
  const pick = (model: string): void => {
    close()
    p.onChange(model)
  }
  return (
    <span className="cchip-anchor" onKeyDown={(e) => escCloses(e, open, close)}>
      <button
        className={`cchip ${open ? 'open' : ''}`}
        disabled={p.disabled}
        onClick={() => {
          if (!open) p.onOpen()
          setOpen((o) => !o)
          setManual(null)
        }}
        title="Modelo de esta sesión (cambia en vivo)"
      >
        {modelChipLabel(p.model, p.autoModel)}
        {p.fallback && <span className="cchip-sub"> · resp. {modelChipLabel(p.fallback, '')}</span>}
        <span className="cchip-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onMouseDown={close} />
          <div className="cchip-pop cchip-pop--model cd-pop" role="menu">
            <div className="cchip-scroll">
              <button
                className={`cchip-item ${p.model === '' ? 'sel' : ''}`}
                onClick={() => pick('')}
              >
                <b>auto</b>
                <span>{p.autoModel ? `ahora ${p.autoModel}` : 'el que elija Claude Code'}</span>
              </button>
              {groups.map((g) => (
                <div key={g.label} className="cchip-group">
                  <div className="cchip-group-label">{g.label}</div>
                  {g.items.map((it) => (
                    <button
                      key={it.value}
                      className={`cchip-item ${p.model === it.value ? 'sel' : ''}`}
                      onClick={() => pick(it.value)}
                    >
                      <b>{it.label}</b>
                      {it.hint && <span>{it.hint}</span>}
                    </button>
                  ))}
                </div>
              ))}
              {/* un id escrito a mano no está en ninguna lista: sin esto, el
                  menú no podría mostrar lo que está realmente activo */}
              {!esConocido(p.model, p.models) && (
                <div className="cchip-group">
                  <div className="cchip-group-label">Escrito a mano</div>
                  <button className="cchip-item sel" onClick={() => pick(p.model)}>
                    <b>{p.model}</b>
                  </button>
                </div>
              )}
            </div>
            <div className="cchip-foot">
              {manual === null ? (
                <button className="cchip-item" onClick={() => setManual(p.model)}>
                  <b>Otro id…</b>
                  <span>escribir el id exacto</span>
                </button>
              ) : (
                <input
                  className="cd-input cd-input--mono"
                  autoFocus
                  defaultValue={manual}
                  placeholder="claude-opus-4-6"
                  title="Id exacto del modelo; viaja tal cual al CLI"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setManual(null)
                      return
                    }
                    if (e.key !== 'Enter') return
                    pick((e.target as HTMLInputElement).value.trim())
                  }}
                />
              )}
              <label
                className="cchip-fallback"
                title="Modelo de respaldo: entra si el principal está sobrecargado. El principal se reintenta en cada turno, así que una caída pasajera no degrada la sesión. Cambiarlo reinicia la sesión conservando la conversación."
              >
                <span>Respaldo</span>
                <select
                  className="cd-select"
                  value={p.fallback}
                  onChange={(e) => p.onFallbackChange(e.target.value)}
                >
                  <option value="">Sin respaldo</option>
                  {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((it) => (
                        <option key={it.value} value={it.value}>
                          {it.label}
                          {it.hint ? ` · ${it.hint}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {!esConocido(p.fallback, p.models) && (
                    <option value={p.fallback}>{p.fallback}</option>
                  )}
                </select>
              </label>
            </div>
          </div>
        </>
      )}
    </span>
  )
}
