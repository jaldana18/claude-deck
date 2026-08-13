import { useEffect, useState } from 'react'
import type { GlobalAgentInfo, TabMode, TabState } from '../../../shared/types'

interface Props {
  onClose: () => void
  onCreated: (tab: TabState) => void
}

/**
 * Flujo de nueva pestaña: carpeta → modo (chat/terminal) → decisión sobre la
 * configuración global (~/.claude) mostrando los agentes globales detectados.
 * La decisión se recuerda por proyecto.
 */
export function NewTabDialog(p: Props): React.JSX.Element {
  const [cwd, setCwd] = useState('')
  const [mode, setMode] = useState<TabMode>('chat')
  const [agents, setAgents] = useState<GlobalAgentInfo[]>([])
  const [useGlobal, setUseGlobal] = useState(true)
  const [remember, setRemember] = useState(true)
  const [hasPref, setHasPref] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void window.deck.globalAgents().then(setAgents)
  }, [])

  useEffect(() => {
    if (!cwd) return
    void window.deck.getProjectPrefs(cwd).then((prefs) => {
      if (prefs.useGlobalConfig !== undefined) {
        setUseGlobal(prefs.useGlobalConfig)
        setHasPref(true)
      } else {
        setHasPref(false)
      }
    })
  }, [cwd])

  const pick = async (): Promise<void> => {
    const folder = await window.deck.pickFolder()
    if (folder) setCwd(folder)
  }

  const create = async (): Promise<void> => {
    if (!cwd || creating) return
    setCreating(true)
    if (remember) {
      await window.deck.setProjectPrefs(cwd, { useGlobalConfig: useGlobal })
    }
    const tab = await window.deck.createTab({ cwd, mode, useGlobalConfig: useGlobal })
    p.onCreated(tab)
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Nueva pestaña</h3>
          <button className="iconbtn" onClick={p.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <label>Carpeta del proyecto</label>
          <div className="row">
            <input type="text" value={cwd} placeholder="Elige una carpeta…" readOnly onClick={() => void pick()} />
            <button className="iconbtn" style={{ flex: '0 0 auto' }} onClick={() => void pick()}>
              📁 Elegir
            </button>
          </div>

          <label>Modo de la pestaña</label>
          <div className="mode-cards">
            <div className={`mode-card ${mode === 'chat' ? 'sel' : ''}`} onClick={() => setMode('chat')}>
              <b>💬 Chat</b>
              <span>
                Estilo cliente LLM: markdown renderizado, botones de permisos, botón de stop y
                terminal integrado abajo.
              </span>
            </div>
            <div
              className={`mode-card ${mode === 'terminal' ? 'sel' : ''}`}
              onClick={() => setMode('terminal')}
            >
              <b>⌨️ Terminal clásico</b>
              <span>La TUI de claude a pantalla completa, como en la consola de siempre.</span>
            </div>
          </div>

          {mode === 'chat' && (
            <>
              <label>
                Configuración global de este PC (~/.claude)
                {hasPref && <span className="hint"> — preferencia recordada para este proyecto</span>}
              </label>
              {agents.length > 0 ? (
                <div className="global-box">
                  <p className="hint" style={{ marginTop: 0 }}>
                    Este PC tiene <b>{agents.length}</b> agente(s) global(es). ¿Debe esta sesión
                    usarlos (junto con skills y CLAUDE.md globales)?
                  </p>
                  <div className="global-agents">
                    {agents.map((a) => (
                      <div key={a.name} className="item">
                        <div className="info" title={a.description}>
                          <div className="name">🤖 {a.name}</div>
                          <div className="desc">{a.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <label className="radio">
                      <input type="radio" checked={useGlobal} onChange={() => setUseGlobal(true)} /> Usar
                      configuración global
                    </label>
                    <label className="radio">
                      <input type="radio" checked={!useGlobal} onChange={() => setUseGlobal(false)} /> Solo
                      la del proyecto
                    </label>
                  </div>
                  <label className="radio" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />{' '}
                    Recordar para este proyecto
                  </label>
                </div>
              ) : (
                <p className="hint">Este PC no tiene agentes globales en ~/.claude/agents.</p>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="iconbtn" onClick={p.onClose}>
            Cancelar
          </button>
          <button className="iconbtn primary" disabled={!cwd || creating} onClick={() => void create()}>
            {creating ? 'Creando…' : 'Abrir pestaña'}
          </button>
        </div>
      </div>
    </div>
  )
}
