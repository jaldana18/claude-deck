import { useState } from 'react'
import type { StoreResult, TabState } from '../../../shared/types'
import { IconStore, IconX } from './Icons'

type StoreTab = 'mcp' | 'agents' | 'skills' | 'plugins'
type Scope = 'user' | 'project'

interface CatalogEntry {
  name: string
  description: string
  command: string
  args: string
  envHint?: string
}

/**
 * Catálogo curado de servidores MCP populares. Elegir uno rellena el
 * formulario (los <valores> entre ángulos hay que completarlos a mano).
 */
const MCP_CATALOG: CatalogEntry[] = [
  {
    name: 'filesystem',
    description: 'Acceso a archivos de carpetas específicas (oficial de Anthropic)',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-filesystem <ruta-permitida>'
  },
  {
    name: 'github',
    description: 'Issues, PRs y repos de GitHub (requiere token personal)',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-github',
    envHint: 'GITHUB_PERSONAL_ACCESS_TOKEN=<tu-token>'
  },
  {
    name: 'playwright',
    description: 'Automatización de navegador: abrir páginas, clic, capturas (Microsoft)',
    command: 'npx',
    args: '-y @playwright/mcp@latest'
  },
  {
    name: 'context7',
    description: 'Documentación actualizada de librerías para el contexto (Upstash)',
    command: 'npx',
    args: '-y @upstash/context7-mcp'
  },
  {
    name: 'memory',
    description: 'Memoria persistente tipo grafo de conocimiento (oficial de Anthropic)',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-memory'
  },
  {
    name: 'sequential-thinking',
    description: 'Razonamiento paso a paso estructurado (oficial de Anthropic)',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-sequential-thinking'
  },
  {
    name: 'azure-devops',
    description: 'Work items, repos, pipelines y wikis de Azure DevOps (Microsoft)',
    command: 'npx',
    args: '-y @azure-devops/mcp <organización> --authentication pat'
  },
  {
    name: 'postgres',
    description: 'Consultas de solo lectura a una base PostgreSQL',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-postgres <connection-string>'
  }
]

/** Divide una línea de argumentos respetando comillas simples/dobles */
function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function parseEnv(s: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of s.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

/**
 * Tienda: agregar servidores MCP (catálogo o manual), importar agentes y
 * skills (archivo/carpeta/URL) e instalar plugins con el CLI de Claude Code.
 * Todo se escribe donde Claude Code ya lo lee, así que aplica también en la
 * consola. Los cambios rigen para sesiones nuevas o al relanzar la pestaña.
 */
export function StoreModal(p: { tab: TabState | null; onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<StoreTab>('mcp')
  const [scope, setScope] = useState<Scope>('user')
  const [result, setResult] = useState<StoreResult | null>(null)
  const [working, setWorking] = useState(false)
  const cwd = p.tab?.cwd ?? ''

  // formulario MCP
  const [mcpName, setMcpName] = useState('')
  const [mcpCommand, setMcpCommand] = useState('npx')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpEnv, setMcpEnv] = useState('')

  // importar por URL
  const [url, setUrl] = useState('')

  // plugins
  const [marketplaceSrc, setMarketplaceSrc] = useState('')
  const [pluginName, setPluginName] = useState('')

  const run = async (fn: () => Promise<StoreResult>): Promise<void> => {
    setWorking(true)
    setResult(null)
    try {
      const r = await fn()
      // message vacío = diálogo cancelado por el usuario: no mostrar nada
      if (r.message) setResult(r)
    } catch (err) {
      setResult({ ok: false, message: String(err) })
    }
    setWorking(false)
  }

  const scopeSelect = (
    <label className="store-scope">
      Instalar en
      <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
        <option value="user">🌐 Usuario (~/.claude — todos los proyectos)</option>
        <option value="project" disabled={!cwd}>
          📁 Proyecto ({cwd ? cwd.split(/[\\/]/).filter(Boolean).at(-1) : 'sin pestaña activa'})
        </option>
      </select>
    </label>
  )

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal store-modal">
        <div className="modal-head">
          <h3 className="iconlabel">
            <IconStore size={15} /> Tienda
          </h3>
          <button className="iconbtn" onClick={p.onClose}>
            <IconX size={13} />
          </button>
        </div>
        <div className="store-tabs">
          {(
            [
              ['mcp', 'Servidores MCP'],
              ['agents', 'Agentes'],
              ['skills', 'Skills'],
              ['plugins', 'Plugins']
            ] as [StoreTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`store-tab ${tab === id ? 'active' : ''}`}
              onClick={() => {
                setTab(id)
                setResult(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="modal-body store-body">
          {tab === 'mcp' && (
            <>
              {scopeSelect}
              <div className="side-section-title">Catálogo</div>
              <div className="store-catalog">
                {MCP_CATALOG.map((e) => (
                  <div
                    key={e.name}
                    className={`store-item ${mcpName === e.name ? 'sel' : ''}`}
                    onClick={() => {
                      setMcpName(e.name)
                      setMcpCommand(e.command)
                      setMcpArgs(e.args)
                      setMcpEnv(e.envHint ?? '')
                    }}
                    title="Clic para rellenar el formulario con este servidor"
                  >
                    <b>{e.name}</b>
                    <span>{e.description}</span>
                  </div>
                ))}
              </div>
              <div className="side-section-title">Agregar servidor</div>
              <p className="hint">
                Completa los valores entre {'<ángulos>'} si los hay. Variables de entorno: una por
                línea, formato CLAVE=valor.
              </p>
              <div className="store-form">
                <label>Nombre</label>
                <input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="mi-servidor" />
                <label>Comando</label>
                <input value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="npx" />
                <label>Argumentos</label>
                <input value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} placeholder="-y paquete-mcp" />
                <label>Variables</label>
                <textarea rows={2} value={mcpEnv} onChange={(e) => setMcpEnv(e.target.value)} placeholder="API_KEY=..." />
              </div>
              <button
                className="iconbtn primary"
                disabled={working || !mcpName.trim() || !mcpCommand.trim() || /<[^>]+>/.test(mcpArgs + mcpEnv)}
                title={/<[^>]+>/.test(mcpArgs + mcpEnv) ? 'Completa los valores entre <ángulos>' : ''}
                onClick={() =>
                  void run(() =>
                    window.deck.storeAddMcp({
                      scope,
                      cwd,
                      name: mcpName,
                      command: mcpCommand,
                      argsList: splitArgs(mcpArgs),
                      env: parseEnv(mcpEnv)
                    })
                  )
                }
              >
                Agregar servidor MCP
              </button>
            </>
          )}

          {tab === 'agents' && (
            <>
              {scopeSelect}
              <p className="hint">
                Un agente es un archivo .md con frontmatter (name, description, tools…). Se copia a
                la carpeta <code>agents/</code> del alcance elegido y aparece de inmediato en el
                panel de configuración.
              </p>
              <button
                className="iconbtn primary"
                disabled={working}
                onClick={() => void run(() => window.deck.storeImportAgents(scope, cwd))}
              >
                📂 Importar archivos .md…
              </button>
              <div className="side-section-title">Desde una URL</div>
              <div className="store-urlrow">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repo/blob/main/agente.md"
                />
                <button
                  className="iconbtn"
                  disabled={working || !url.trim()}
                  onClick={() =>
                    void run(() => window.deck.storeImportUrl({ kind: 'agent', scope, cwd, url }))
                  }
                >
                  Descargar
                </button>
              </div>
              <p className="hint">
                Colecciones conocidas: wshobson/agents, VoltAgent/awesome-claude-code-subagents
                (busca el .md y pega su enlace).
              </p>
            </>
          )}

          {tab === 'skills' && (
            <>
              {scopeSelect}
              <p className="hint">
                Una skill es una carpeta con un <code>SKILL.md</code> (y archivos de apoyo). Se copia
                a <code>skills/</code> del alcance elegido.
              </p>
              <button
                className="iconbtn primary"
                disabled={working}
                onClick={() => void run(() => window.deck.storeImportSkill(scope, cwd))}
              >
                📂 Importar carpeta de skill…
              </button>
              <div className="side-section-title">Desde una URL (SKILL.md)</div>
              <div className="store-urlrow">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repo/blob/main/mi-skill/SKILL.md"
                />
                <button
                  className="iconbtn"
                  disabled={working || !url.trim()}
                  onClick={() =>
                    void run(() => window.deck.storeImportUrl({ kind: 'skill', scope, cwd, url }))
                  }
                >
                  Descargar
                </button>
              </div>
              <p className="hint">
                Catálogo oficial de Anthropic: github.com/anthropics/skills (cada carpeta es una
                skill instalable).
              </p>
            </>
          )}

          {tab === 'plugins' && (
            <>
              <p className="hint">
                Los plugins de Claude Code empaquetan comandos, agentes, skills y MCPs, y se
                instalan desde <b>marketplaces</b> (repos de GitHub). Esto usa tu CLI de{' '}
                <code>claude</code>; lo instalado funciona también en la consola.
              </p>
              <div className="side-section-title">1. Agregar marketplace</div>
              <div className="store-urlrow">
                <input
                  value={marketplaceSrc}
                  onChange={(e) => setMarketplaceSrc(e.target.value)}
                  placeholder="usuario/repo de GitHub o URL (ej. anthropics/claude-code)"
                />
                <button
                  className="iconbtn"
                  disabled={working || !marketplaceSrc.trim()}
                  onClick={() =>
                    void run(() => window.deck.storePlugin(['marketplace', 'add', marketplaceSrc.trim()], cwd || '.'))
                  }
                >
                  Agregar
                </button>
              </div>
              <div className="side-section-title">2. Instalar plugin</div>
              <div className="store-urlrow">
                <input
                  value={pluginName}
                  onChange={(e) => setPluginName(e.target.value)}
                  placeholder="nombre-plugin@marketplace"
                />
                <button
                  className="iconbtn primary"
                  disabled={working || !pluginName.trim()}
                  onClick={() =>
                    void run(() =>
                      window.deck.storePlugin(['install', pluginName.trim(), '-s', scope], cwd || '.')
                    )
                  }
                >
                  Instalar
                </button>
              </div>
              {scopeSelect}
              <div className="store-urlrow" style={{ marginTop: 8 }}>
                <button
                  className="iconbtn"
                  disabled={working}
                  onClick={() => void run(() => window.deck.storePlugin(['marketplace', 'list'], cwd || '.'))}
                >
                  Ver marketplaces
                </button>
                <button
                  className="iconbtn"
                  disabled={working}
                  onClick={() => void run(() => window.deck.storePlugin(['list'], cwd || '.'))}
                >
                  Ver plugins instalados
                </button>
              </div>
            </>
          )}

          {working && (
            <p className="hint">
              <span className="spinner" /> Trabajando…
            </p>
          )}
          {result && (
            <div className={`validation ${result.ok ? 'good' : 'err'}`}>
              <pre className="store-output">{result.message}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
