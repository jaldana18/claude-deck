import { useState } from 'react'
import type {
  ArtifactDraft,
  ArtifactKind,
  ConfigScope,
  ProjectConfig,
  ValidationResult
} from '../../../shared/types'

interface Props {
  kind: ArtifactKind
  cwd: string
  onClose: () => void
  onCreated: (config: ProjectConfig) => void
}

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact'
]

const KIND_LABEL: Record<ArtifactKind, string> = {
  agent: 'agente',
  skill: 'skill',
  hook: 'hook',
  command: 'comando'
}

/** Herramientas integradas de Claude Code seleccionables por checklist */
const TOOL_OPTIONS: { id: string; desc: string }[] = [
  { id: 'Read', desc: 'Leer archivos' },
  { id: 'Write', desc: 'Crear archivos' },
  { id: 'Edit', desc: 'Editar archivos' },
  { id: 'NotebookEdit', desc: 'Editar notebooks' },
  { id: 'Bash', desc: 'Ejecutar comandos' },
  { id: 'Glob', desc: 'Buscar archivos' },
  { id: 'Grep', desc: 'Buscar en contenido' },
  { id: 'WebFetch', desc: 'Leer páginas web' },
  { id: 'WebSearch', desc: 'Buscar en la web' },
  { id: 'Task', desc: 'Lanzar subagentes' },
  { id: 'TodoWrite', desc: 'Plan de tareas' }
]

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Heredar (el de la sesión)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' }
]

/** Checklist de herramientas: vacío = todas (heredar) */
function ToolsPicker(p: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const selected = p.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const toggle = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]
    p.onChange(next.join(', '))
  }
  return (
    <div className="tools-picker">
      <button
        type="button"
        className={`tool-chip ${selected.length === 0 ? 'sel' : ''}`}
        onClick={() => p.onChange('')}
        title="Sin restricción: hereda todas las herramientas"
      >
        Todas
      </button>
      {TOOL_OPTIONS.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`tool-chip ${selected.includes(t.id) ? 'sel' : ''}`}
          onClick={() => toggle(t.id)}
          title={t.desc}
        >
          {t.id}
        </button>
      ))}
    </div>
  )
}

/**
 * Formulario de creación con capa intermedia de validación IA: el borrador se
 * envía a una sesión headless de Claude Code que verifica lo mínimo viable.
 * Si no es viable, muestra problemas + una versión mejorada aplicable con un clic.
 */
export function CreateDialog(p: Props): React.JSX.Element {
  const [scope, setScope] = useState<ConfigScope>('project')
  const [fields, setFields] = useState<Record<string, string>>({
    name: '',
    description: '',
    prompt: '',
    content: '',
    tools: '',
    model: '',
    event: 'Stop',
    matcher: '',
    command: ''
  })
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')

  const set = (k: string, v: string): void => {
    setFields((f) => ({ ...f, [k]: v }))
    setResult(null)
  }

  const buildDraft = (): ArtifactDraft => {
    if (p.kind === 'agent') {
      return {
        kind: 'agent',
        scope,
        cwd: p.cwd,
        data: {
          name: fields.name,
          description: fields.description,
          prompt: fields.prompt,
          tools: fields.tools || undefined,
          model: fields.model || undefined
        }
      }
    }
    if (p.kind === 'skill') {
      return {
        kind: 'skill',
        scope,
        cwd: p.cwd,
        data: {
          name: fields.name,
          description: fields.description,
          content: fields.content,
          tools: fields.tools || undefined
        }
      }
    }
    return {
      kind: 'hook',
      scope,
      cwd: p.cwd,
      data: {
        event: fields.event,
        matcher: fields.matcher,
        command: fields.command,
        description: fields.description
      }
    }
  }

  const validate = async (): Promise<void> => {
    setValidating(true)
    setError('')
    setResult(null)
    try {
      setResult(await window.deck.validateArtifact(buildDraft()))
    } catch (err) {
      setError(String(err))
    } finally {
      setValidating(false)
    }
  }

  const create = async (): Promise<void> => {
    setError('')
    try {
      const res = await window.deck.createArtifact(buildDraft())
      p.onCreated(res.config)
    } catch (err) {
      setError(String(err))
    }
  }

  const applySuggestion = (): void => {
    if (!result?.version_mejorada) return
    setFields((f) => {
      const next = { ...f }
      for (const [k, v] of Object.entries(result.version_mejorada!)) {
        if (k in next && typeof v === 'string') next[k] = v
      }
      return next
    })
    setResult(null)
  }

  const canValidate =
    p.kind === 'hook'
      ? fields.command.trim() && fields.description.trim()
      : fields.name.trim() && fields.description.trim()

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Crear {KIND_LABEL[p.kind]} · validado con IA</h3>
          <button className="iconbtn" onClick={p.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="row">
            <div>
              <label>Alcance</label>
              <select value={scope} onChange={(e) => setScope(e.target.value as ConfigScope)}>
                <option value="project">Este proyecto (.claude/)</option>
                <option value="user">Global (~/.claude/)</option>
              </select>
            </div>
            {p.kind === 'hook' ? (
              <div>
                <label>Evento</label>
                <select value={fields.event} onChange={(e) => set('event', e.target.value)}>
                  {HOOK_EVENTS.map((ev) => (
                    <option key={ev}>{ev}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label>Nombre</label>
                <input
                  type="text"
                  value={fields.name}
                  placeholder={p.kind === 'agent' ? 'revisor-seguridad' : 'deploy-checklist'}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
            )}
          </div>

          <label>Descripción (cuándo debe usarse/activarse)</label>
          <textarea
            style={{ minHeight: 60 }}
            value={fields.description}
            placeholder="Describe con claridad cuándo se activa y qué hace…"
            onChange={(e) => set('description', e.target.value)}
          />

          {p.kind === 'agent' && (
            <>
              <label>Prompt del agente (instrucciones de sistema)</label>
              <textarea
                value={fields.prompt}
                placeholder="Eres un agente que…"
                onChange={(e) => set('prompt', e.target.value)}
              />
              <label>Herramientas permitidas (clic para marcar; «Todas» = sin restricción)</label>
              <ToolsPicker value={fields.tools} onChange={(v) => set('tools', v)} />
              <label>Modelo del agente</label>
              <select value={fields.model} onChange={(e) => set('model', e.target.value)}>
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </>
          )}

          {p.kind === 'skill' && (
            <>
              <label>Contenido de SKILL.md (instrucciones)</label>
              <textarea
                value={fields.content}
                placeholder="Pasos, convenciones o plantillas que Claude debe seguir…"
                onChange={(e) => set('content', e.target.value)}
              />
              <label>Herramientas permitidas por la skill («Todas» = sin restricción)</label>
              <ToolsPicker value={fields.tools} onChange={(v) => set('tools', v)} />
            </>
          )}

          {p.kind === 'hook' && (
            <>
              <div className="row">
                <div>
                  <label>Matcher (opcional, ej: Bash, Edit|Write)</label>
                  <input type="text" value={fields.matcher} onChange={(e) => set('matcher', e.target.value)} />
                </div>
              </div>
              <label>Comando a ejecutar (Windows)</label>
              <textarea
                style={{ minHeight: 60 }}
                value={fields.command}
                placeholder="powershell -Command …"
                onChange={(e) => set('command', e.target.value)}
              />
            </>
          )}

          {error && <div className="validation err">{error}</div>}

          {result && !result.ok && (
            <div className="validation err">
              <b>El validador no pudo evaluar el borrador.</b>
              <div className="hint">{result.error}</div>
              {result.raw && <div className="hint">{result.raw.slice(0, 300)}</div>}
            </div>
          )}

          {result?.ok && (
            <div className={`validation ${result.viable ? 'good' : 'bad'}`}>
              <div>
                {result.viable ? '✅ Viable' : '⚠️ Aún no viable'} ·{' '}
                <span className="score">{result.puntaje}/10</span>
              </div>
              {result.problemas.length > 0 && (
                <>
                  <b>Problemas:</b>
                  <ul>
                    {result.problemas.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.sugerencias.length > 0 && (
                <>
                  <b>Sugerencias:</b>
                  <ul>
                    {result.sugerencias.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.version_mejorada && (
                <button className="iconbtn" onClick={applySuggestion}>
                  ✍️ Usar la redacción mejorada propuesta por la IA
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="iconbtn" onClick={p.onClose}>
            Cancelar
          </button>
          {result?.ok && !result.viable && (
            <button className="iconbtn" onClick={() => void create()} title="Ignora la advertencia de la IA">
              Crear de todos modos
            </button>
          )}
          {result?.ok && result.viable ? (
            <button className="iconbtn primary" onClick={() => void create()}>
              Crear {KIND_LABEL[p.kind]}
            </button>
          ) : (
            <button
              className="iconbtn primary"
              disabled={!canValidate || validating}
              onClick={() => void validate()}
            >
              {validating ? (
                <>
                  <span className="spinner" />
                  Validando con Claude…
                </>
              ) : (
                '🔍 Validar con IA'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
