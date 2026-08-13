import { useCallback, useEffect, useState } from 'react'
import type { SessionListItem, TabState } from '../../../shared/types'
import { IconHistory, IconRefresh, IconX } from './Icons'

interface Props {
  tab: TabState
  onClose: () => void
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} día${d > 1 ? 's' : ''}`
}

/**
 * Historial de sesiones del proyecto de la pestaña activa. Clic en una sesión
 * = restaurarla en la pestaña actual (equivalente a /resume): el chat se
 * repinta con ese historial y la conversación continúa ahí.
 */
export function SessionsPanel(p: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setSessions(await window.deck.chatSessions(p.tab.cwd))
    setLoading(false)
  }, [p.tab.cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const restore = (s: SessionListItem): void => {
    if (p.tab.mode !== 'chat') return
    if (s.sessionId === p.tab.claudeSessionId) return
    void window.deck.chatResumeSession(p.tab.id, s.sessionId)
  }

  return (
    <div className="sessions-panel">
      <header>
        <h3 className="iconlabel">
          <IconHistory size={13} /> Sesiones del proyecto
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="iconbtn" onClick={() => void refresh()} title="Refrescar">
            <IconRefresh size={13} />
          </button>
          <button className="iconbtn" onClick={p.onClose} title="Cerrar (Ctrl+Shift+H)">
            <IconX size={13} />
          </button>
        </div>
      </header>
      <div className="sessions-list">
        {loading && <p className="hint">Leyendo sesiones…</p>}
        {!loading && sessions.length === 0 && (
          <p className="hint">No hay sesiones previas en {p.tab.cwd}.</p>
        )}
        {p.tab.mode !== 'chat' && (
          <p className="hint">
            Esta pestaña es de terminal clásico: usa <code>/resume</code> en la TUI para cambiar de
            sesión, o abre una pestaña de chat.
          </p>
        )}
        {sessions.map((s) => {
          const active = s.sessionId === p.tab.claudeSessionId
          return (
            <div
              key={s.sessionId}
              className={`session-item ${active ? 'active' : ''} ${p.tab.mode === 'chat' ? '' : 'disabled'}`}
              onClick={() => restore(s)}
              title={
                active
                  ? 'Sesión actual de esta pestaña'
                  : p.tab.mode === 'chat'
                    ? 'Restaurar esta sesión en la pestaña actual'
                    : undefined
              }
            >
              <div className="session-title">
                {active ? '⏺ ' : ''}
                {s.summary.slice(0, 90)}
              </div>
              {s.firstPrompt && s.firstPrompt !== s.summary && (
                <div className="session-sub">{s.firstPrompt.slice(0, 110)}</div>
              )}
              <div className="session-meta">{timeAgo(s.lastModified)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
