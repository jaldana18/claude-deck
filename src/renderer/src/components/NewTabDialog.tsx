import { useEffect, useState } from 'react'
import type { AgentCliId, CliInfo, GlobalAgentInfo, TabMode, TabState } from '../../../shared/types'

interface Props {
  onClose: () => void
  onCreated: (tab: TabState) => void
}

/**
 * Primer arranque: elegir el CLI de agente por defecto del sistema. Se
 * detecta cuáles están instalados; la elección se recuerda y preselecciona
 * en cada pestaña nueva (siempre se puede cambiar por pestaña).
 */
export function CliOnboarding(p: { onDone: () => void }): React.JSX.Element {
  const [clis, setClis] = useState<CliInfo[]>([])
  const [sel, setSel] = useState<AgentCliId>('claude')
  const [customCmd, setCustomCmd] = useState('')

  useEffect(() => {
    void window.deck.cliDetect().then((list) => {
      setClis(list)
      const firstAvailable = list.find((c) => c.available && c.id !== 'custom')
      if (firstAvailable) setSel(firstAvailable.id)
    })
  }, [])

  const save = async (): Promise<void> => {
    await window.deck.cliSetDefault(sel, sel === 'custom' ? customCmd.trim() : undefined)
    p.onDone()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h3>👋 Bienvenido a Claude Deck</h3>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            ¿Con qué CLI de agente trabajas? La app se adapta a él: será el modo por defecto de
            tus pestañas (puedes cambiarlo en cada una). El <b>modo chat</b> (burbujas, permisos,
            widgets de salud) es exclusivo de Claude Code; los demás corren su consola completa.
          </p>
          <div className="mode-cards" style={{ flexDirection: 'column' }}>
            {clis.map((c) => (
              <div
                key={c.id}
                className={`mode-card ${sel === c.id ? 'sel' : ''}`}
                onClick={() => setSel(c.id)}
              >
                <b>
                  {c.id === 'claude' ? '✳' : c.id === 'codex' ? '◉' : c.id === 'gemini' ? '✦' : '›_'}{' '}
                  {c.name}
                </b>
                <span>
                  {c.available ? '✓ detectado en este PC' : '– no encontrado en el PATH'}
                  {c.id === 'claude' && ' · chat + terminal + resurrección de sesiones'}
                </span>
              </div>
            ))}
          </div>
          {sel === 'custom' && (
            <input
              className="cd-input cd-input--mono"
              style={{ marginTop: 8 }}
              value={customCmd}
              placeholder="comando a ejecutar, ej.: aider --model gpt-5"
              onChange={(e) => setCustomCmd(e.target.value)}
            />
          )}
        </div>
        <div className="modal-foot">
          <button
            className="cd-btn cd-btn--primary"
            disabled={sel === 'custom' && !customCmd.trim()}
            onClick={() => void save()}
          >
            Empezar
          </button>
        </div>
      </div>
    </div>
  )
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
  const [clis, setClis] = useState<CliInfo[]>([])
  const [cli, setCli] = useState<AgentCliId>('claude')
  const [customCmd, setCustomCmd] = useState('')

  useEffect(() => {
    void window.deck.globalAgents().then(setAgents)
    void window.deck.cliDetect().then(setClis)
    void window.deck.cliGetDefault().then((d) => {
      if (d.cli) {
        setCli(d.cli as AgentCliId)
        if (d.command) setCustomCmd(d.command)
        if (d.cli !== 'claude') setMode('terminal')
      }
    })
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
    const tab = await window.deck.createTab({
      cwd,
      mode,
      useGlobalConfig: useGlobal,
      ...(mode === 'terminal'
        ? { cli, ...(cli === 'custom' ? { cliCommand: customCmd.trim() } : {}) }
        : {})
    })
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
            <div
              className={`mode-card ${mode === 'chat' ? 'sel' : ''} ${cli !== 'claude' ? 'disabled' : ''}`}
              title={cli !== 'claude' ? 'El modo chat es exclusivo de Claude Code (Agent SDK)' : ''}
              onClick={() => {
                if (cli === 'claude') setMode('chat')
              }}
            >
              <b>💬 Chat</b>
              <span>
                Estilo cliente LLM: markdown renderizado, botones de permisos, botón de stop y
                terminal integrado abajo. Solo con Claude Code.
              </span>
            </div>
            <div
              className={`mode-card ${mode === 'terminal' ? 'sel' : ''}`}
              onClick={() => setMode('terminal')}
            >
              <b>⌨️ Terminal clásico</b>
              <span>La TUI del CLI elegido a pantalla completa, como en la consola.</span>
            </div>
          </div>

          {mode === 'terminal' && (
            <>
              <label>CLI de agente</label>
              <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
                {clis.map((c) => (
                  <button
                    key={c.id}
                    className="cd-chip"
                    aria-pressed={cli === c.id}
                    disabled={!c.available}
                    title={c.available ? '' : 'No encontrado en el PATH de este PC'}
                    onClick={() => setCli(c.id)}
                  >
                    {c.name}
                    {!c.available && ' ⚠'}
                  </button>
                ))}
              </div>
              {cli === 'custom' && (
                <input
                  className="cd-input cd-input--mono"
                  value={customCmd}
                  placeholder="comando a ejecutar, ej.: aider --model gpt-5"
                  onChange={(e) => setCustomCmd(e.target.value)}
                />
              )}
              {cli !== 'claude' && (
                <p className="hint">
                  Con {clis.find((c) => c.id === cli)?.name ?? cli} la pestaña corre su consola;
                  la resurrección automática de sesión aplica solo a Claude Code.
                </p>
              )}
            </>
          )}

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
