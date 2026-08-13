import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ArtifactKind,
  ConfigItem,
  HookItem,
  ProjectConfig,
  TabState
} from '../../../shared/types'
import { CreateDialog } from './CreateDialog'
import { AgentDialog, CommandDialog, SkillDialog } from './CreateDialogs'
import {
  IconBook,
  IconBot,
  IconCommand,
  IconFileText,
  IconHook,
  IconPlug,
  IconRefresh,
  IconX
} from './Icons'

interface Props {
  tab: TabState
  onClose: () => void
}

interface Preview {
  title: string
  content: string
  top: number
}

export function ConfigPanel(p: Props): React.JSX.Element {
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<ArtifactKind | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({
    agents: true,
    commands: true,
    skills: true,
    hooks: false,
    mcp: false,
    claudemd: false
  })
  const [preview, setPreview] = useState<Preview | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Previsualización flotante al pasar el mouse (contenido real del archivo) */
  const startPreview = useCallback((title: string, e: React.MouseEvent, path?: string, inline?: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const top = Math.min((e.currentTarget as HTMLElement).getBoundingClientRect().top, window.innerHeight - 340)
    hoverTimer.current = setTimeout(() => {
      if (inline !== undefined) {
        setPreview({ title, content: inline, top })
      } else if (path) {
        void window.deck.configPreview(path).then((content) => setPreview({ title, content, top }))
      }
    }, 350)
  }, [])

  const endPreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setPreview(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setConfig(await window.deck.scanConfig(p.tab.cwd))
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }, [p.tab.cwd])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 6000)
    return () => clearInterval(t)
  }, [refresh])

  const toggle = async (item: ConfigItem): Promise<void> => {
    try {
      setConfig(
        await window.deck.toggleConfig({
          kind: item.kind,
          cwd: p.tab.cwd,
          path: item.path,
          name: item.name,
          enable: !item.enabled
        })
      )
    } catch (err) {
      setError(String(err))
    }
  }

  const toggleHook = async (hook: HookItem): Promise<void> => {
    try {
      setConfig(await window.deck.toggleHook(hook, p.tab.cwd, !hook.enabled))
    } catch (err) {
      setError(String(err))
    }
  }

  const section = (
    key: string,
    title: React.ReactNode,
    count: number,
    body: React.ReactNode,
    onCreate?: () => void
  ): React.JSX.Element => (
    <div className="section">
      <div className="section-head" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
        <span className="section-title">
          {open[key] ? '▾' : '▸'} {title} <span className="count">{count}</span>
        </span>
        {onCreate && (
          <button
            className="iconbtn"
            onClick={(e) => {
              e.stopPropagation()
              onCreate()
            }}
          >
            + Nuevo
          </button>
        )}
      </div>
      {open[key] && body}
    </div>
  )

  const itemRow = (item: ConfigItem): React.JSX.Element => (
    <div
      key={item.scope + item.path + item.name}
      className={`item ${item.enabled ? '' : 'disabled'}`}
      onMouseEnter={(e) =>
        item.kind === 'mcp'
          ? startPreview(item.name, e, undefined, item.description || '(sin definición)')
          : startPreview(item.name, e, item.path)
      }
      onMouseLeave={endPreview}
    >
      <div className="info">
        <div className="name">{item.name}</div>
        {item.description && <div className="desc">{item.description}</div>}
      </div>
      <span className={`chip ${item.scope}`}>{item.scope === 'user' ? 'usuario' : 'proyecto'}</span>
      <label className="switch" title={item.readonly ? 'Solo lectura (vive en ~/.claude.json)' : 'Activar/desactivar'}>
        <input
          type="checkbox"
          checked={item.enabled}
          disabled={item.readonly}
          onChange={() => void toggle(item)}
        />
        <span className="slider" />
      </label>
    </div>
  )

  const hookRow = (hook: HookItem, i: number): React.JSX.Element => (
    <div
      key={i}
      className={`item ${hook.enabled ? '' : 'disabled'}`}
      onMouseEnter={(e) =>
        startPreview(
          `Hook ${hook.event}`,
          e,
          undefined,
          `Evento: ${hook.event}\nMatcher: ${hook.matcher || '(todos)'}\nArchivo: ${hook.file}\n\nComando:\n${hook.command}`
        )
      }
      onMouseLeave={endPreview}
    >
      <div className="info">
        <div className="name">
          {hook.event}
          {hook.matcher ? ` · ${hook.matcher}` : ''}
          {hook.managed ? ' · (claude-deck)' : ''}
        </div>
        <div className="desc">{hook.command}</div>
      </div>
      <span className={`chip ${hook.scope}`}>{hook.scope === 'user' ? 'usuario' : 'proyecto'}</span>
      <label className="switch">
        <input type="checkbox" checked={hook.enabled} onChange={() => void toggleHook(hook)} />
        <span className="slider" />
      </label>
    </div>
  )

  return (
    <div className="config-panel">
      <header>
        <h3>Configuración del proyecto</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="iconbtn" onClick={() => void refresh()} title="Refrescar">
            <IconRefresh size={13} />
          </button>
          <button className="iconbtn" onClick={p.onClose} title="Cerrar panel">
            <IconX size={13} />
          </button>
        </div>
      </header>
      <div className="content">
        {error && <div className="validation err">{error}</div>}
        {!config && !error && <p className="hint">Leyendo configuración…</p>}
        {config && (
          <>
            {!config.deckHooksInstalled && (
              <div className="banner">
                <span>
                  Activa las <b>notificaciones de estado</b> para este proyecto (badge por pestaña +
                  aviso de Windows cuando Claude termina o pide permiso).
                </span>
                <button
                  className="iconbtn primary"
                  onClick={() =>
                    void window.deck
                      .installDeckHooks(p.tab.cwd, true)
                      .then(setConfig)
                      .catch((e) => setError(String(e)))
                  }
                >
                  Activar
                </button>
              </div>
            )}
            <p className="hint">
              Los cambios aplican a sesiones nuevas de Claude (o tras relanzar la pestaña).
            </p>
            {section(
              'agents',
              <>
                <IconBot size={13} /> Agentes
              </>,
              config.agents.length,
              config.agents.map(itemRow),
              () => setCreating('agent')
            )}
            {section(
              'commands',
              <>
                <IconCommand size={13} /> Comandos
              </>,
              config.commands.length,
              config.commands.map(itemRow),
              () => setCreating('command')
            )}
            {section(
              'skills',
              <>
                <IconBook size={13} /> Skills
              </>,
              config.skills.length,
              config.skills.map(itemRow),
              () => setCreating('skill')
            )}
            {section(
              'hooks',
              <>
                <IconHook size={13} /> Hooks
              </>,
              config.hooks.length,
              config.hooks.map(hookRow),
              () => setCreating('hook')
            )}
            {section(
              'mcp',
              <>
                <IconPlug size={13} /> MCP servers
              </>,
              config.mcp.length,
              config.mcp.map(itemRow)
            )}
            {section(
              'claudemd',
              <>
                <IconFileText size={13} /> CLAUDE.md
              </>,
              config.claudeMd.filter((c) => c.exists).length,
              config.claudeMd.map((c) => (
                <div key={c.path} className={`item ${c.exists ? '' : 'disabled'}`}>
                  <div className="info" title={c.exists ? c.preview : c.path}>
                    <div className="name">{c.scope === 'user' ? 'Global (~/.claude)' : 'Proyecto'}</div>
                    <div className="desc">
                      {c.exists ? `${(c.bytes / 1024).toFixed(1)} KB — ${c.path}` : 'No existe'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
      {preview && (
        <div className="hover-preview" style={{ top: preview.top }}>
          <div className="hover-preview-title">{preview.title}</div>
          <pre>{preview.content}</pre>
        </div>
      )}
      {creating === 'hook' && (
        <CreateDialog
          kind="hook"
          cwd={p.tab.cwd}
          onClose={() => setCreating(null)}
          onCreated={(cfg) => {
            setConfig(cfg)
            setCreating(null)
          }}
        />
      )}
      {creating === 'agent' && (
        <AgentDialog
          cwd={p.tab.cwd}
          onClose={() => setCreating(null)}
          onCreated={(cfg) => {
            setConfig(cfg)
            setCreating(null)
          }}
        />
      )}
      {creating === 'command' && (
        <CommandDialog
          cwd={p.tab.cwd}
          onClose={() => setCreating(null)}
          onCreated={(cfg) => {
            setConfig(cfg)
            setCreating(null)
          }}
        />
      )}
      {creating === 'skill' && (
        <SkillDialog
          cwd={p.tab.cwd}
          onClose={() => setCreating(null)}
          onCreated={(cfg) => {
            setConfig(cfg)
            setCreating(null)
          }}
        />
      )}
    </div>
  )
}
