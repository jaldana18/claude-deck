import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConfigScope,
  PluginManifest,
  ProjectConfig,
  StoreResult,
  ValidationResult
} from '../../../shared/types'

/**
 * Diálogos de creación de artefactos — implementan la sección 8 del
 * «Claude Deck UI Kit»: Agente · Comando · Skill · Plugin. Toda la apariencia
 * sale de claude-deck-ui.css (tokens del kit); aquí solo hay estructura y
 * comportamiento (validación local en vivo, validación IA al guardar,
 * borradores con IA, vista previa del comando, adjuntos con drag&drop).
 */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface ShellProps {
  icon: string
  title: string
  scope: ConfigScope
  onScope: (s: ConfigScope) => void
  path: string
  primaryLabel: string
  primaryDisabled: boolean
  primaryAccent?: boolean
  onPrimary: () => void
  onClose: () => void
  shake?: boolean
  children: React.ReactNode
}

/** Anatomía común: modal 520px, cabecera con alcance, cuerpo con scroll, pie fijo */
function CdShell(p: ShellProps): React.JSX.Element {
  const [closing, setClosing] = useState(false)
  const close = (): void => {
    setClosing(true)
    setTimeout(p.onClose, 100)
  }
  return (
    <div
      className={`cd-overlay ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className={`cd-dialog ${p.shake ? 'cd-shake' : ''}`}>
        <div className="cd-dialog__head">
          <span className="cd-dialog__icon">{p.icon}</span>
          <span className="cd-dialog__title">{p.title}</span>
          <select
            className="cd-select"
            value={p.scope}
            onChange={(e) => p.onScope(e.target.value as ConfigScope)}
            title="Alcance: decide dónde se guarda (ver ruta en el pie)"
          >
            <option value="user">Usuario</option>
            <option value="project">Proyecto</option>
          </select>
          <button className="cd-dialog__close" onClick={close} title="Cerrar">
            ×
          </button>
        </div>
        <div className="cd-dialog__body">{p.children}</div>
        <div className="cd-dialog__foot">
          {/* key = ruta → crossfade 120ms al cambiar el alcance */}
          <span className="cd-path" key={p.path} title={p.path}>
            {p.path}
          </span>
          <button className="cd-btn cd-btn--ghost" onClick={close}>
            Cancelar
          </button>
          <button
            className={`cd-btn ${p.primaryAccent ? 'cd-btn--primary' : 'cd-btn--dark'}`}
            disabled={p.primaryDisabled}
            onClick={p.onPrimary}
          >
            {p.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field(p: {
  label: string
  required?: boolean
  help?: string
  error?: string
  aiLabel?: boolean
  aiDisabled?: boolean
  onAi?: () => void
  aiBusy?: boolean
  flashDelay?: number
  flashSeq?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={p.flashDelay !== undefined ? 'cd-field-flash' : undefined}
      key={p.flashSeq !== undefined && p.flashDelay !== undefined ? `f${p.flashSeq}` : undefined}
      style={p.flashDelay !== undefined ? { animationDelay: `${p.flashDelay}ms` } : undefined}
    >
      <div className="cd-label-row">
        <span className="cd-label">
          {p.label} {p.required && <span className="cd-req">*</span>}
        </span>
        {p.aiLabel && (
          <button className="cd-ai" disabled={p.aiDisabled || p.aiBusy} onClick={p.onAi}>
            {p.aiBusy ? '✦ Generando…' : '✦ Generar borrador con IA'}
          </button>
        )}
      </div>
      {p.children}
      {p.error && <div className="cd-err">{p.error}</div>}
      {p.help && !p.error && <div className="cd-help" style={{ marginTop: 3 }}>{p.help}</div>}
    </div>
  )
}

/** Editor mono con crecimiento automático: mín. 4 líneas, máx. 12 */
function CodeArea(p: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  onRef?: (el: HTMLTextAreaElement | null) => void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    const line = 11.5 * 1.6
    el.style.height = `${Math.min(12 * line + 18, Math.max(4 * line + 18, el.scrollHeight))}px`
  }
  useEffect(() => {
    if (ref.current) grow(ref.current)
  }, [p.value])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        p.onRef?.(el)
      }}
      className={`cd-textarea cd-textarea--code ${p.invalid ? 'cd-textarea--invalid' : ''}`}
      value={p.value}
      placeholder={p.placeholder}
      rows={4}
      onChange={(e) => p.onChange(e.target.value)}
    />
  )
}

function Toggle(p: { checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      className="cd-toggle"
      role="switch"
      aria-checked={p.checked}
      onClick={() => p.onChange(!p.checked)}
    />
  )
}

/** Tarjeta ámbar de validación IA con «Aplicar versión mejorada» / «Ignorar y guardar» */
function AiValidationCard(p: {
  result: ValidationResult
  onApply: () => void
  onIgnore: () => void
  saving: boolean
}): React.JSX.Element {
  const r = p.result
  const avisos = r.problemas.length
  const sugerencias = r.sugerencias.length
  return (
    <div className="cd-callout--warn cd-reveal">
      <div className="cd-callout__title">
        ⚠ Validación IA · {avisos} aviso{avisos !== 1 ? 's' : ''} · {sugerencias} sugerencia
        {sugerencias !== 1 ? 's' : ''}
      </div>
      <div className="cd-callout__list">
        {r.problemas.map((x, i) => (
          <div key={`p${i}`}>
            · <b>Aviso:</b> {x}
          </div>
        ))}
        {r.sugerencias.map((x, i) => (
          <div key={`s${i}`}>
            · <b>Sugerencia:</b> {x}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {r.version_mejorada && (
          <button className="cd-btn cd-btn--primary" onClick={p.onApply} disabled={p.saving}>
            Aplicar versión mejorada
          </button>
        )}
        <button className="cd-btn cd-btn--ghost" onClick={p.onIgnore} disabled={p.saving}>
          {p.saving ? 'Guardando…' : 'Ignorar y guardar'}
        </button>
      </div>
    </div>
  )
}

interface DialogProps {
  cwd: string
  onClose: () => void
  onCreated: (cfg: ProjectConfig) => void
}

/* ==================== AGENTE ==================== */

const AGENT_TOOLS = ['Read', 'Grep', 'Bash', 'Edit', 'Write', 'WebFetch', 'Task']

export function AgentDialog(p: DialogProps): React.JSX.Element {
  const [scope, setScope] = useState<ConfigScope>('project')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [description, setDescription] = useState('')
  const [tools, setTools] = useState<Set<string>>(new Set(['Read', 'Grep']))
  const [bashList, setBashList] = useState('')
  const [prompt, setPrompt] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'save' | 'draft' | null>(null)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState<{ seq: number; fields: string[] }>({ seq: 0, fields: [] })

  const nameErr =
    name && !KEBAB.test(name) ? 'kebab-case: minúsculas, números y guiones' : undefined
  const valid = KEBAB.test(name) && description.trim().length > 0 && prompt.trim().length > 0

  const toolsString = (): string | undefined => {
    if (tools.size === 0) return undefined
    return AGENT_TOOLS.filter((t) => tools.has(t))
      .flatMap((t) => {
        if (t !== 'Bash') return [t]
        const cmds = bashList.split(',').map((c) => c.trim()).filter(Boolean)
        return cmds.length ? cmds.map((c) => `Bash(${c}:*)`) : ['Bash']
      })
      .join(', ')
  }

  const draft = (): { kind: 'agent'; scope: ConfigScope; cwd: string; data: Record<string, string | undefined> } => ({
    kind: 'agent',
    scope,
    cwd: p.cwd,
    data: {
      name,
      description: description.trim(),
      prompt: prompt.trim(),
      tools: toolsString(),
      model: model || undefined
    }
  })

  const save = async (): Promise<void> => {
    setBusy('save')
    setError('')
    try {
      const res = await window.deck.createArtifact(draft() as never)
      p.onCreated(res.config)
    } catch (err) {
      setError(String(err))
      setBusy(null)
    }
  }

  const onPrimary = async (): Promise<void> => {
    if (validation) return void save()
    setBusy('validate')
    setError('')
    const r = await window.deck.validateArtifact(draft() as never)
    setBusy(null)
    if (!r.ok && r.error) {
      setError(`La validación IA no está disponible (${r.error}). Puedes guardar de todos modos.`)
      setValidation({ ...r, problemas: [], sugerencias: [], version_mejorada: null })
      return
    }
    if (r.problemas.length || r.sugerencias.length) {
      setValidation(r)
      if (!r.viable) {
        setShake(true)
        setTimeout(() => setShake(false), 300)
      }
    } else {
      await save()
    }
  }

  const applyImproved = (): void => {
    const v = validation?.version_mejorada
    if (!v) return
    const changed: string[] = []
    if (typeof v.name === 'string' && v.name !== name) (setName(v.name), changed.push('name'))
    if (typeof v.description === 'string' && v.description !== description)
      (setDescription(v.description), changed.push('description'))
    if (typeof v.prompt === 'string' && v.prompt !== prompt)
      (setPrompt(v.prompt), changed.push('prompt'))
    if (typeof v.model === 'string' && v.model !== model) (setModel(v.model), changed.push('model'))
    // flash --accent-soft 300ms escalonado 60ms por campo modificado
    setFlash((f) => ({ seq: f.seq + 1, fields: changed }))
    setValidation(null)
  }

  const generate = async (): Promise<void> => {
    setBusy('draft')
    try {
      const text = await window.deck.artifactDraft({ kind: 'agent', name, description })
      setPrompt(text)
      setFlash((f) => ({ seq: f.seq + 1, fields: ['prompt'] }))
    } catch (err) {
      setError(String(err))
    }
    setBusy(null)
  }

  const fd = (field: string): number | undefined =>
    flash.fields.includes(field) ? flash.fields.indexOf(field) * 60 : undefined

  return (
    <CdShell
      icon="🤖"
      title="Nuevo agente"
      scope={scope}
      onScope={setScope}
      path={`${scope === 'user' ? '~/.claude' : '.claude'}/agents/${name || '<nombre>'}.md`}
      primaryLabel={
        busy === 'validate' ? 'Validando…' : busy === 'save' ? 'Guardando…' : 'Guardar agente'
      }
      primaryDisabled={!valid || busy !== null}
      onPrimary={() => void onPrimary()}
      onClose={p.onClose}
      shake={shake}
    >
      <div className="cd-grid2">
        <Field label="Nombre" required help="kebab-case, sin espacios" error={nameErr} flashDelay={fd('name')} flashSeq={flash.seq}>
          <input
            className={`cd-input cd-input--mono ${nameErr ? 'cd-input--invalid' : ''}`}
            value={name}
            placeholder="deploy-checker"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Modelo" help="heredar · haiku · sonnet · opus" flashDelay={fd('model')} flashSeq={flash.seq}>
          <select className="cd-select" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">heredar</option>
            <option value="haiku">haiku · rápido</option>
            <option value="sonnet">sonnet · equilibrado</option>
            <option value="opus">opus · profundo</option>
          </select>
        </Field>
      </div>
      <Field
        label="Descripción"
        required
        help="Claude la usa para decidir cuándo delegarle trabajo"
        flashDelay={fd('description')}
        flashSeq={flash.seq}
      >
        <input
          className="cd-input"
          value={description}
          placeholder="Verifica que el build y los checks pasen antes de un deploy"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div>
        <div className="cd-label-row">
          <span className="cd-label">Herramientas permitidas</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {AGENT_TOOLS.map((t) => (
            <button
              key={t}
              className="cd-chip"
              aria-pressed={tools.has(t)}
              onClick={() =>
                setTools((s) => {
                  const n = new Set(s)
                  if (n.has(t)) n.delete(t)
                  else n.add(t)
                  return n
                })
              }
            >
              {t}
              {tools.has(t) ? ' ✓' : ''}
            </button>
          ))}
        </div>
        {tools.has('Bash') && (
          <div className="cd-reveal">
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}
              className="cd-input cd-input--mono"
            >
              <span style={{ color: 'var(--fg-2)', flex: 'none' }}>Bash:</span>
              <input
                style={{ border: 'none', background: 'none', outline: 'none', flex: 1, font: 'inherit', color: 'var(--fg)' }}
                value={bashList}
                placeholder="npm run build, npm test, gh pr checks"
                onChange={(e) => setBashList(e.target.value)}
              />
            </div>
            <div className="cd-help" style={{ marginTop: 3 }}>
              con Bash activo, lista blanca de comandos (recomendado)
            </div>
          </div>
        )}
      </div>
      <Field
        label="Prompt de sistema"
        required
        aiLabel
        aiDisabled={!name || !description.trim()}
        aiBusy={busy === 'draft'}
        onAi={() => void generate()}
        flashDelay={fd('prompt')}
        flashSeq={flash.seq}
      >
        <CodeArea
          value={prompt}
          onChange={setPrompt}
          placeholder="Eres un verificador de deploys. Ejecuta build y tests… Termina cuando…"
        />
      </Field>
      {validation && (validation.problemas.length > 0 || validation.sugerencias.length > 0) && (
        <AiValidationCard
          result={validation}
          onApply={applyImproved}
          onIgnore={() => void save()}
          saving={busy === 'save'}
        />
      )}
      {error && <div className="cd-err">{error}</div>}
    </CdShell>
  )
}

/* ==================== COMANDO ==================== */

export function CommandDialog(p: DialogProps): React.JSX.Element {
  const [scope, setScope] = useState<ConfigScope>('user')
  const [name, setName] = useState('')
  const [useArgs, setUseArgs] = useState(true)
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [previewFlash, setPreviewFlash] = useState(0)
  const preRef = useRef<HTMLPreElement | null>(null)

  const nameErr =
    name && !KEBAB.test(name) ? 'kebab-case: minúsculas, números y guiones' : undefined
  const argsErr =
    useArgs && template && !template.includes('$ARGUMENTS')
      ? 'la plantilla no usa $ARGUMENTS (desactiva el toggle o insértalo)'
      : undefined
  const valid = KEBAB.test(name) && template.trim().length > 0 && !argsErr

  // vista previa en vivo: flash sutil 200ms al cambiar nombre/descripción
  useEffect(() => {
    if (!name && !description) return
    const t = setTimeout(() => setPreviewFlash((v) => v + 1), 250)
    return () => clearTimeout(t)
  }, [name, description])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await window.deck.createArtifact({
        kind: 'command',
        scope,
        cwd: p.cwd,
        data: { name, description: description.trim(), template: template.trim() }
      } as never)
      p.onCreated(res.config)
    } catch (err) {
      setError(String(err))
      setBusy(false)
    }
  }

  const generate = async (): Promise<void> => {
    setAiBusy(true)
    try {
      const text = await window.deck.artifactDraft({ kind: 'command', name, description })
      setTemplate(useArgs && !text.includes('$ARGUMENTS') ? `${text}\n\nArgumento: $ARGUMENTS` : text)
    } catch (err) {
      setError(String(err))
    }
    setAiBusy(false)
  }

  // resaltado de $ARGUMENTS: pre coloreado detrás del textarea transparente
  const highlighted = (): React.JSX.Element[] => {
    const parts = template.split('$ARGUMENTS')
    const out: React.JSX.Element[] = []
    parts.forEach((part, i) => {
      out.push(<span key={`t${i}`}>{part}</span>)
      if (i < parts.length - 1) out.push(<mark key={`m${i}`}>$ARGUMENTS</mark>)
    })
    return out
  }

  return (
    <CdShell
      icon="›_"
      title="Nuevo comando"
      scope={scope}
      onScope={setScope}
      path={`${scope === 'user' ? '~/.claude' : '.claude'}/commands/${name || '<nombre>'}.md`}
      primaryLabel={busy ? 'Guardando…' : 'Guardar comando'}
      primaryDisabled={!valid || busy}
      onPrimary={() => void save()}
      onClose={p.onClose}
    >
      <div className="cd-grid2">
        <Field label="Nombre" required error={nameErr}>
          <div className={`cd-prefix ${nameErr ? 'cd-input--invalid' : ''}`}>
            <span>/</span>
            <input value={name} placeholder="release" onChange={(e) => setName(e.target.value)} />
          </div>
        </Field>
        <Field label="Argumentos">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 5 }}>
            <Toggle checked={useArgs} onChange={setUseArgs} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              $ARGUMENTS
            </span>
          </div>
        </Field>
      </div>
      <Field label="Descripción" help="se muestra en el menú de autocompletado «/»">
        <input
          className="cd-input"
          value={description}
          placeholder="Prepara changelog y bump de versión"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label="Plantilla del prompt"
        required
        error={argsErr}
        help="$ARGUMENTS se resalta en acento dentro del editor"
        aiLabel
        aiDisabled={!name}
        aiBusy={aiBusy}
        onAi={() => void generate()}
      >
        <div className="cd-hlwrap">
          <pre ref={preRef} aria-hidden>
            {highlighted()}
            {'\n'}
          </pre>
          <CodeArea
            value={template}
            onChange={setTemplate}
            invalid={Boolean(argsErr)}
            placeholder={'Revisa los commits desde la última etiqueta.\nSube la versión $ARGUMENTS en package.json.'}
          />
        </div>
      </Field>
      <div className="cd-previewbox">
        <div className="cd-previewbox__tag">VISTA PREVIA EN EL COMPOSER</div>
        <div className="cd-previewrow flash" key={previewFlash}>
          <span className="cmd">/{name || 'nombre'}</span>
          <span className="desc">{description || 'sin descripción'}</span>
          <span className="cd-badge">{scope === 'user' ? 'usuario' : 'proyecto'}</span>
        </div>
      </div>
      {error && <div className="cd-err">{error}</div>}
    </CdShell>
  )
}

/* ==================== SKILL ==================== */

export function SkillDialog(p: DialogProps): React.JSX.Element {
  const [scope, setScope] = useState<ConfigScope>('project')
  const [name, setName] = useState('')
  const [whenActive, setWhenActive] = useState('')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<{ path: string; name: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'save' | 'draft' | null>(null)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  const nameErr =
    name && !KEBAB.test(name) ? 'kebab-case: minúsculas, números y guiones' : undefined
  const valid = KEBAB.test(name) && whenActive.trim().length > 0 && content.trim().length > 0

  const addPaths = (paths: string[]): void => {
    setFiles((fs) => {
      const known = new Set(fs.map((f) => f.path))
      const extra = paths
        .filter((x) => x && !known.has(x))
        .map((x) => ({ path: x, name: x.split(/[\\/]/).filter(Boolean).at(-1) ?? x }))
      return [...fs, ...extra]
    })
  }

  const draft = (): never =>
    ({
      kind: 'skill',
      scope,
      cwd: p.cwd,
      data: {
        name,
        description: whenActive.trim(),
        content: content.trim(),
        attachments: files.map((f) => f.path)
      }
    }) as never

  const save = async (): Promise<void> => {
    setBusy('save')
    setError('')
    try {
      const res = await window.deck.createArtifact(draft())
      p.onCreated(res.config)
    } catch (err) {
      setError(String(err))
      setBusy(null)
    }
  }

  const onPrimary = async (): Promise<void> => {
    if (validation) return void save()
    setBusy('validate')
    setError('')
    const r = await window.deck.validateArtifact(draft())
    setBusy(null)
    if (!r.ok && r.error) {
      setError(`La validación IA no está disponible (${r.error}). Puedes guardar de todos modos.`)
      setValidation({ ...r, problemas: [], sugerencias: [], version_mejorada: null })
      return
    }
    if (r.problemas.length || r.sugerencias.length) {
      setValidation(r)
      if (!r.viable) {
        setShake(true)
        setTimeout(() => setShake(false), 300)
      }
    } else {
      await save()
    }
  }

  const applyImproved = (): void => {
    const v = validation?.version_mejorada
    if (!v) return
    if (typeof v.name === 'string') setName(v.name)
    if (typeof v.description === 'string') setWhenActive(v.description)
    if (typeof v.content === 'string') setContent(v.content)
    setValidation(null)
  }

  const generate = async (): Promise<void> => {
    setBusy('draft')
    try {
      const text = await window.deck.artifactDraft({
        kind: 'skill',
        name,
        description: whenActive
      })
      setContent(text)
    } catch (err) {
      setError(String(err))
    }
    setBusy(null)
  }

  return (
    <CdShell
      icon="◆"
      title="Nueva skill"
      scope={scope}
      onScope={setScope}
      path={`${scope === 'user' ? '~/.claude' : '.claude'}/skills/${name || '<nombre>'}/`}
      primaryLabel={
        busy === 'validate' ? 'Validando…' : busy === 'save' ? 'Guardando…' : 'Guardar skill'
      }
      primaryDisabled={!valid || busy !== null}
      onPrimary={() => void onPrimary()}
      onClose={p.onClose}
      shake={shake}
    >
      <Field label="Nombre" required error={nameErr}>
        <input
          className={`cd-input cd-input--mono ${nameErr ? 'cd-input--invalid' : ''}`}
          value={name}
          placeholder="factura-electronica"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label="Cuándo se activa"
        required
        help="la descripción decide si Claude carga la skill — sé específico"
      >
        <input
          className="cd-input"
          value={whenActive}
          placeholder="Cuando el usuario trabaje con XML de facturación, validación DIAN o plantillas fiscales"
          onChange={(e) => setWhenActive(e.target.value)}
        />
      </Field>
      <Field
        label="Contenido (SKILL.md)"
        required
        aiLabel
        aiDisabled={!name || !whenActive.trim()}
        aiBusy={busy === 'draft'}
        onAi={() => void generate()}
      >
        <CodeArea
          value={content}
          onChange={setContent}
          placeholder={'# Título\n## Sección\nInstrucciones concretas…'}
        />
      </Field>
      <div>
        <div className="cd-label-row">
          <span className="cd-label">Archivos adjuntos</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {files.map((f) => (
            <div className="cd-file" key={f.path} title={f.path}>
              <span>📄</span>
              <span className="name">{f.name}</span>
              <button onClick={() => setFiles((fs) => fs.filter((x) => x.path !== f.path))}>
                ×
              </button>
            </div>
          ))}
          <div
            className={`cd-filedrop ${dragOver ? 'over' : ''}`}
            onClick={() => void window.deck.pickFiles().then(addPaths)}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(false)
              addPaths([...e.dataTransfer.files].map((f) => window.deck.pathForFile(f)))
            }}
          >
            + arrastrar o elegir archivos
          </div>
        </div>
        <div className="cd-help" style={{ marginTop: 3 }}>
          se copian a la carpeta de la skill; referéncialos desde el markdown
        </div>
      </div>
      {validation && (validation.problemas.length > 0 || validation.sugerencias.length > 0) && (
        <AiValidationCard
          result={validation}
          onApply={applyImproved}
          onIgnore={() => void save()}
          saving={busy === 'save'}
        />
      )}
      {error && <div className="cd-err">{error}</div>}
    </CdShell>
  )
}

/* ==================== PLUGIN ==================== */

type PluginSource = 'market' | 'git' | 'local'

export function PluginDialog(p: { cwd: string; onClose: () => void }): React.JSX.Element {
  const [scope, setScope] = useState<ConfigScope>('user')
  const [source, setSource] = useState<PluginSource>('market')
  const [value, setValue] = useState('')
  const [localDir, setLocalDir] = useState('')
  const [manifest, setManifest] = useState<PluginManifest | null>(null)
  const [detailsRaw, setDetailsRaw] = useState('')
  const [permComponents, setPermComponents] = useState(true)
  const [permHooks, setPermHooks] = useState(false)
  const [busy, setBusy] = useState<'read' | 'install' | null>(null)
  const [result, setResult] = useState<StoreResult | null>(null)

  const reset = (): void => {
    setManifest(null)
    setDetailsRaw('')
    setResult(null)
  }

  const pickLocal = useCallback(async () => {
    const dir = await window.deck.pickFolder()
    if (!dir) return
    setLocalDir(dir)
    setBusy('read')
    reset()
    setManifest(await window.deck.storePluginManifest(dir))
    setBusy(null)
  }, [])

  const readDetails = async (): Promise<void> => {
    if (!value.trim()) return
    setBusy('read')
    reset()
    const r = await window.deck.storePlugin(['details', value.trim()], p.cwd || '.')
    setDetailsRaw(r.message)
    setBusy(null)
  }

  const install = async (): Promise<void> => {
    setBusy('install')
    setResult(null)
    let r: StoreResult
    if (source === 'market') {
      r = await window.deck.storePlugin(['install', value.trim(), '-s', scope], p.cwd || '.')
    } else if (source === 'git') {
      r = await window.deck.storePlugin(['marketplace', 'add', value.trim()], p.cwd || '.')
    } else {
      r = await window.deck.storePlugin(['marketplace', 'add', localDir], p.cwd || '.')
      if (r.ok && manifest?.name) {
        r = await window.deck.storePlugin(['install', manifest.name, '-s', scope], p.cwd || '.')
      }
    }
    setResult(r)
    setBusy(null)
  }

  const hooksDetected = manifest?.ok ? manifest.hooks : []
  const canInstall =
    source === 'market'
      ? value.trim().length > 0
      : source === 'git'
        ? value.trim().length > 0
        : Boolean(localDir && manifest?.ok)

  const footInfo = manifest?.ok
    ? [`v${manifest.version ?? '?'}`, manifest.license ?? 'sin licencia', manifest.name]
        .filter(Boolean)
        .join(' · ')
    : source === 'local'
      ? localDir || 'elige una carpeta'
      : value || 'plugin@marketplace'

  return (
    <CdShell
      icon="⬡"
      title="Instalar plugin"
      scope={scope}
      onScope={setScope}
      path={footInfo}
      primaryLabel={
        busy === 'install'
          ? 'Instalando…'
          : source === 'git'
            ? 'Agregar marketplace'
            : 'Instalar plugin'
      }
      primaryDisabled={!canInstall || busy !== null}
      primaryAccent
      onPrimary={() => void install()}
      onClose={p.onClose}
    >
      <div>
        <div className="cd-label-row">
          <span className="cd-label">Fuente</span>
        </div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
          {(
            [
              ['market', 'Marketplace'],
              ['git', 'Repo git'],
              ['local', 'Carpeta local']
            ] as [PluginSource, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className="cd-chip"
              aria-pressed={source === id}
              onClick={() => {
                setSource(id)
                reset()
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {source === 'market' && (
          <div style={{ display: 'flex', gap: 7 }}>
            <input
              className="cd-input cd-input--mono"
              value={value}
              placeholder="pr-review@anthropics/claude-code-plugins"
              onChange={(e) => setValue(e.target.value)}
            />
            <button
              className="cd-btn cd-btn--ghost"
              style={{ flex: 'none' }}
              disabled={!value.trim() || busy !== null}
              onClick={() => void readDetails()}
            >
              {busy === 'read' ? 'Leyendo…' : 'Leer detalles'}
            </button>
          </div>
        )}
        {source === 'git' && (
          <>
            <input
              className="cd-input cd-input--mono"
              value={value}
              placeholder="usuario/repo o URL del repositorio"
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="cd-help" style={{ marginTop: 3 }}>
              se agrega como marketplace; después instala sus plugins desde «Marketplace»
            </div>
          </>
        )}
        {source === 'local' && (
          <button className="cd-btn cd-btn--ghost" onClick={() => void pickLocal()}>
            📁 {localDir ? localDir.split(/[\\/]/).filter(Boolean).at(-1) : 'Elegir carpeta del plugin…'}
          </button>
        )}
      </div>

      <div className="cd-manifest">
        <div className="cd-manifest__tag">ESTE PLUGIN APORTA</div>
        {manifest?.ok && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="cd-manifest__row">
              <span>›_</span>
              {manifest.commands.length} comando{manifest.commands.length !== 1 ? 's' : ''}:{' '}
              <span className="mono" style={{ color: 'var(--accent)' }}>
                {manifest.commands.map((c) => `/${c}`).join(' · ') || '—'}
              </span>
            </div>
            <div className="cd-manifest__row">
              <span>🤖</span>
              {manifest.agents.length} agente{manifest.agents.length !== 1 ? 's' : ''}:{' '}
              <span className="mono">{manifest.agents.join(' · ') || '—'}</span>
            </div>
            <div className="cd-manifest__row">
              <span>⛨</span>
              {manifest.hooks.length} hook{manifest.hooks.length !== 1 ? 's' : ''}:{' '}
              <span className="mono">{manifest.hooks.join(' · ') || '—'}</span>
              {manifest.hooks.length > 0 && <span className="cd-badge--warn">requiere revisión</span>}
            </div>
          </div>
        )}
        {manifest && !manifest.ok && <div className="cd-err">{manifest.error}</div>}
        {!manifest && detailsRaw && <pre>{detailsRaw}</pre>}
        {!manifest && !detailsRaw && (
          <div className="cd-help">
            {source === 'market'
              ? 'usa «Leer detalles» para ver el inventario del plugin'
              : source === 'git'
                ? 'el inventario se conoce al agregar el marketplace'
                : 'elige la carpeta para leer su manifiesto'}
          </div>
        )}
      </div>

      <div>
        <div className="cd-label-row">
          <span className="cd-label">Permisos</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="cd-permrow">
            <Toggle checked={permComponents} onChange={setPermComponents} />
            Activar sus comandos y agentes
          </div>
          <div className="cd-permrow">
            <Toggle checked={permHooks} onChange={setPermHooks} />
            Ejecutar sus hooks automáticamente{' '}
            <span className="cd-help" style={{ margin: 0 }}>
              (revisar primero)
            </span>
          </div>
        </div>
      </div>

      {(hooksDetected.length > 0 || (!permHooks && source !== 'git')) && (
        <div className="cd-callout--warn" style={{ fontSize: 11, lineHeight: 1.55 }}>
          <b style={{ color: '#8a6d3b' }}>⚠ Revisión de seguridad IA:</b>{' '}
          {hooksDetected.length > 0
            ? `el plugin trae hooks (${hooksDetected.join(', ')}) que ejecutan scripts externos. Revisa su contenido tras instalar; puedes desactivar el plugin desde Configuración.`
            : 'si el plugin trae hooks, ejecutan scripts externos en tu PC. Revísalos tras instalar desde el panel de Configuración.'}
        </div>
      )}

      {result && (
        <div className="cd-manifest">
          <div className="cd-manifest__tag">{result.ok ? 'RESULTADO' : 'ERROR'}</div>
          <pre>{result.message}</pre>
        </div>
      )}
    </CdShell>
  )
}
