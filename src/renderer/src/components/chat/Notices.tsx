import { memo, useEffect, useState, type ReactNode } from 'react'
import { Markdown } from '../Markdown'
import { IconAlertCircle, IconAlertTriangle, IconChevronRight, IconLightbulb, IconRefresh } from '../Icons'
import { formatDuration } from '../../../../shared/messageTime'
import type { ChatMessage } from '../../../../shared/types'
import { liveStateFor, wordCount, type NoticeTone } from './logic'

const TONE_ICON: Record<NoticeTone, ReactNode> = {
  info: <IconRefresh size={12} />,
  warn: <IconAlertTriangle size={12} />,
  error: <IconAlertCircle size={12} />
}

/** Aviso de la app (auto-compact, continuación, errores): línea centrada, no burbuja */
export const SystemNotice = memo(function SystemNotice(p: {
  text: string
  tone?: NoticeTone
  icon?: ReactNode
}): React.JSX.Element {
  const tone = p.tone ?? 'info'
  return (
    <div className={`cr-notice cr-notice--${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <span className="cr-notice-line" />
      <span className="cr-notice-body">
        <span className="cr-notice-icon">{p.icon ?? TONE_ICON[tone]}</span>
        <span className="cr-notice-text">{p.text}</span>
      </span>
      <span className="cr-notice-line" />
    </div>
  )
})

/** Razonamiento del modelo: plegado por defecto */
export const ThinkingBlock = memo(function ThinkingBlock(p: {
  text: string
  streaming?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!p.text.trim()) return null
  const words = wordCount(p.text)
  return (
    <div className={`cr-thinking${open ? ' open' : ''}`}>
      <button type="button" className="cr-thinking-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconChevronRight size={11} className={`cr-chev${open ? ' open' : ''}`} />
        <IconLightbulb size={12} />
        <span>
          Razonamiento · {words} {words === 1 ? 'palabra' : 'palabras'}
        </span>
        {p.streaming && <span className="cd-dot cd-dot--busy" />}
      </button>
      {open && (
        <div className="cr-thinking-body">
          <Markdown text={p.text} />
        </div>
      )}
    </div>
  )
})

/** Línea viva bajo el último mensaje mientras la sesión trabaja */
export const LiveStatus = memo(function LiveStatus(p: {
  busy: boolean
  messages: ChatMessage[]
  streamingText?: string
  compacting?: boolean
  /** opcional: rutas relativas en la etiqueta */
  cwd?: string
}): React.JSX.Element | null {
  const st = liveStateFor(p.messages, {
    streamingText: p.streamingText,
    compacting: p.compacting,
    cwd: p.cwd
  })
  const [since, setSince] = useState(() => ({ key: st.key, at: Date.now() }))
  const [now, setNow] = useState(() => Date.now())

  // Reinicia el cronómetro al cambiar de actividad (ajuste de estado en render)
  if (since.key !== st.key) setSince({ key: st.key, at: Date.now() })

  useEffect(() => {
    if (!p.busy) return
    // Un turno nuevo con la misma actividad («Pensando») no hereda el reloj del anterior
    setSince((s) => ({ key: s.key, at: Date.now() }))
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [p.busy])

  if (!p.busy) return null
  const secs = Math.max(0, now - since.at)
  return (
    <div className="cr-live" role="status" aria-live="polite">
      <span className="cd-dot cd-dot--busy" />
      <span className="cr-live-label">{st.label}</span>
      {st.code && (
        <code className="cr-live-code" title={st.code}>
          {st.code}
        </code>
      )}
      <span className="cr-live-ellipsis">…</span>
      {st.more > 0 && <span className="cr-live-more">+{st.more} en paralelo</span>}
      {secs >= 1000 && <span className="cr-live-time">{formatDuration(secs)}</span>}
    </div>
  )
})
