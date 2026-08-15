import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../shared/types'

/** Presets del umbral de auto-compact, en tokens. 0 = desactivado. */
const PRESETS: { label: string; tokens: number; hint: string }[] = [
  { label: 'Off', tokens: 0, hint: 'sin compactación automática' },
  { label: '100k', tokens: 100_000, hint: 'agresivo — el más barato' },
  { label: '150k', tokens: 150_000, hint: 'recomendado' },
  { label: '200k', tokens: 200_000, hint: 'conservador' },
  { label: '300k', tokens: 300_000, hint: 'solo contextos largos' }
]

/**
 * Coste aproximado de UN turno solo por releer el contexto, a tarifa de
 * lectura de caché de Opus ($0,50 por millón). Sirve para que el número de
 * tokens signifique algo: el gasto crece linealmente con el contexto y se
 * paga en cada turno, no una sola vez.
 */
function costPerTurn(tokens: number): string {
  return `$${((tokens / 1_000_000) * 0.5).toFixed(2)}`
}

function fmt(n: number): string {
  if (n === 0) return 'off'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function SettingsModal(p: { onClose: () => void }): React.JSX.Element {
  const [tokens, setTokens] = useState(150_000)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    void window.deck.getGlobalSettings().then((s: GlobalSettings) => {
      setTokens(s.autoCompactTokens ?? 0)
      setLoaded(true)
    })
  }, [])

  const close = (): void => {
    setClosing(true)
    setTimeout(p.onClose, 100)
  }

  const save = async (): Promise<void> => {
    await window.deck.setGlobalSettings({ autoCompactTokens: tokens })
    setSaved(true)
    setTimeout(close, 500)
  }

  return (
    <div
      className={`cd-overlay ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div className="cd-dialog">
        <div className="cd-dialog__head">
          <span className="cd-dialog__icon">⚙</span>
          <span className="cd-dialog__title">Ajustes de la aplicación</span>
          <button className="cd-dialog__close" onClick={close} title="Cerrar">
            ×
          </button>
        </div>

        <div className="cd-dialog__body">
          <label className="cd-label">Auto-compactar el contexto a partir de</label>
          <p className="cd-help">
            La API no tiene memoria: en cada turno se reenvía la conversación entera. Un contexto de
            600k cuesta <b>{costPerTurn(600_000)}</b> por turno solo en releerse; a 150k son{' '}
            <b>{costPerTurn(150_000)}</b>. Compactar a tiempo es la palanca que más reduce el gasto.
          </p>

          <div className="cd-chiprow">
            {PRESETS.map((preset) => (
              <button
                key={preset.tokens}
                type="button"
                className="cd-chip"
                aria-pressed={tokens === preset.tokens}
                onClick={() => setTokens(preset.tokens)}
                title={preset.hint}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="params-row two" style={{ marginTop: 12 }}>
            <div>
              <label className="cd-label">Tokens exactos</label>
              <input
                className="cd-input"
                type="number"
                min={0}
                step={10_000}
                value={tokens}
                onChange={(e) => setTokens(Math.max(0, parseInt(e.target.value, 10) || 0))}
                placeholder="0 = desactivado"
              />
            </div>
            <div>
              <label className="cd-label">Coste por turno a ese umbral</label>
              <div className="cd-input" style={{ display: 'flex', alignItems: 'center' }}>
                {tokens > 0 ? `~${costPerTurn(tokens)} (Opus)` : '—'}
              </div>
            </div>
          </div>

          <p className="cd-help" style={{ marginTop: 12 }}>
            Aplica a todas las pestañas de chat. Cada pestaña puede sobreescribirlo desde 🎛
            Parámetros del LLM. Como tope de seguridad, la app encadena un máximo de{' '}
            <b>3 compactaciones automáticas</b> sin que escribas nada; a partir de ahí avisa y se
            detiene, en vez de seguir compactando y reanudando sola.
          </p>
        </div>

        <div className="cd-dialog__foot">
          <span className="cd-path">{loaded ? `Umbral actual: ${fmt(tokens)}` : 'Cargando…'}</span>
          <button className="cd-btn" onClick={close}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" onClick={() => void save()} disabled={!loaded}>
            {saved ? '✓ Guardado' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
