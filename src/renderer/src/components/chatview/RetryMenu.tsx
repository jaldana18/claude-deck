import { useEffect } from 'react'
import type { ModelOption } from '../../../../shared/types'
import { modelGroups } from './modelOptions'

const MENU_MAX_H = 340

/**
 * Menú «Reintentar con…». Vive fuera de la burbuja y con posición fija: las
 * burbujas usan `content-visibility`, que recorta todo lo que se salga de ellas.
 */
export function RetryMenu(p: {
  anchor: DOMRect
  models: ModelOption[]
  current: string
  autoModel: string
  onPick: (model: string) => void
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      p.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p])

  const below = p.anchor.bottom + MENU_MAX_H + 8 < window.innerHeight
  const style: React.CSSProperties = {
    right: Math.max(8, window.innerWidth - p.anchor.right),
    ...(below
      ? { top: p.anchor.bottom + 4 }
      : { bottom: window.innerHeight - p.anchor.top + 4 })
  }
  const groups = modelGroups(p.models)
  return (
    <>
      <div className="menu-backdrop" onMouseDown={p.onClose} />
      <div className="retry-menu cchip-pop cd-pop" style={style} role="menu">
        <div className="cchip-group-label">Reenviar el prompt anterior con…</div>
        <div className="cchip-scroll">
          <button
            className={`cchip-item ${p.current === '' ? 'sel' : ''}`}
            onClick={() => p.onPick('')}
          >
            <b>auto</b>
            {p.autoModel && <span>ahora {p.autoModel}</span>}
          </button>
          {groups.map((g) => (
            <div key={g.label} className="cchip-group">
              <div className="cchip-group-label">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.value}
                  className={`cchip-item ${p.current === it.value ? 'sel' : ''}`}
                  onClick={() => p.onPick(it.value)}
                >
                  <b>{it.label}</b>
                  {it.hint && <span>{it.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
