import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AskQuestion,
  ChatAttachment,
  ChatMessage,
  LlmParams,
  ModelOption,
  PermissionModeId,
  PermissionRequestEvent,
  QuestionRequestEvent,
  SlashCommandInfo,
  TabState,
  TodoItem,
  WidgetState
} from '../../../shared/types'
import { WidgetDock } from './WidgetDock'
import { Markdown, MarkdownCwd } from './Markdown'
import {
  IconCommand,
  IconEye,
  IconPaperclip,
  IconSend,
  IconStop,
  IconTasks,
  IconTune,
  IconX
} from './Icons'

interface Props {
  tab: TabState
  visible: boolean
  widgets: WidgetState[]
  onWidgetsChange: (widgets: WidgetState[]) => void
}

const MODE_LABEL: Record<PermissionModeId, string> = {
  default: '🔒 Preguntar',
  acceptEdits: '✏️ Auto-editar',
  bypassPermissions: '⚡ Auto total',
  plan: '📋 Plan'
}

interface Attachment extends ChatAttachment {
  dataUrl: string
}

/**
 * Parámetros del LLM de la pestaña. Claude Code no expone la temperatura de
 * muestreo: el control real es el esfuerzo de razonamiento y el thinking.
 * Guardar reinicia la sesión con resume (la conversación continúa).
 */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** Paradas del slider de thinking: off · adaptativo · presupuestos fijos */
const THINK_STOPS: { label: string; budget: number | undefined }[] = [
  { label: 'off', budget: 0 },
  { label: 'adaptativo', budget: undefined },
  { label: '4k', budget: 4096 },
  { label: '8k', budget: 8192 },
  { label: '16k', budget: 16_384 },
  { label: '32k', budget: 32_768 }
]

/** Slider estilo mockup 1c: barra con porción acento y perilla blanca */
function ParamSlider(p: {
  label: string
  valueLabel: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100
  return (
    <div className="params-row">
      <div className="params-slider-head">
        <label>{p.label}</label>
        <span className="params-value">{p.valueLabel}</span>
      </div>
      <input
        type="range"
        className="params-slider"
        min={p.min}
        max={p.max}
        step={1}
        value={p.value}
        style={{
          background: `linear-gradient(90deg, var(--accent) ${pct}%, color-mix(in srgb, var(--fg-3) 30%, transparent) ${pct}%)`
        }}
        onChange={(e) => p.onChange(parseInt(e.target.value, 10))}
      />
    </div>
  )
}

function LlmParamsPopover(p: { tab: TabState; onClose: () => void }): React.JSX.Element {
  const lp = p.tab.llmParams ?? {}
  // slider de esfuerzo: posición 2 = high (default del CLI)
  const [effortIdx, setEffortIdx] = useState(
    lp.effort ? EFFORTS.indexOf(lp.effort) : 2
  )
  const [effortTouched, setEffortTouched] = useState(Boolean(lp.effort))
  const [thinkIdx, setThinkIdx] = useState(() => {
    if (lp.thinkingBudget === undefined) return 1
    const i = THINK_STOPS.findIndex((s) => s.budget === lp.thinkingBudget)
    return i >= 0 ? i : 3
  })
  const [maxTurns, setMaxTurns] = useState(lp.maxTurns ? String(lp.maxTurns) : '')
  const [maxUsd, setMaxUsd] = useState(lp.maxBudgetUsd ? String(lp.maxBudgetUsd) : '')
  const [append, setAppend] = useState(lp.systemPromptAppend ?? '')
  const [dirs, setDirs] = useState<string[]>(lp.additionalDirs ?? [])
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    const think = THINK_STOPS[thinkIdx]
    const params: LlmParams = {
      ...(effortTouched ? { effort: EFFORTS[effortIdx] } : {}),
      ...(think.budget !== undefined ? { thinkingBudget: think.budget } : {}),
      ...(parseInt(maxTurns, 10) > 0 ? { maxTurns: parseInt(maxTurns, 10) } : {}),
      ...(parseFloat(maxUsd) > 0 ? { maxBudgetUsd: parseFloat(maxUsd) } : {}),
      ...(append.trim() ? { systemPromptAppend: append.trim() } : {}),
      ...(dirs.length ? { additionalDirs: dirs } : {})
    }
    setSaving(true)
    p.tab.llmParams = params
    await window.deck.chatSetLlmParams(p.tab.id, params)
    setSaving(false)
    p.onClose()
  }

  return (
    <div className="params-pop cd-pop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="params-title">
        🎛 Parámetros del LLM
        <button className="widget-btn" onClick={p.onClose} title="Cerrar">
          <IconX size={11} />
        </button>
      </div>
      <ParamSlider
        label="Esfuerzo de razonamiento"
        valueLabel={effortTouched ? EFFORTS[effortIdx] : 'default (high)'}
        min={0}
        max={EFFORTS.length - 1}
        value={effortIdx}
        onChange={(v) => {
          setEffortIdx(v)
          setEffortTouched(true)
        }}
      />
      <ParamSlider
        label="Presupuesto de razonamiento"
        valueLabel={THINK_STOPS[thinkIdx].label}
        min={0}
        max={THINK_STOPS.length - 1}
        value={thinkIdx}
        onChange={setThinkIdx}
      />
      <div className="params-row two">
        <div>
          <label className="cd-label">Máx. turnos</label>
          <input
            className="cd-input"
            type="number"
            min={1}
            placeholder="∞"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            title="La consulta se detiene tras N turnos (vacío = sin límite)"
          />
        </div>
        <div>
          <label className="cd-label">Presupuesto US$</label>
          <input
            className="cd-input"
            type="number"
            min={0}
            step={0.5}
            placeholder="∞"
            value={maxUsd}
            onChange={(e) => setMaxUsd(e.target.value)}
            title="La consulta se detiene al superar este costo (vacío = sin límite)"
          />
        </div>
      </div>
      <div className="params-row">
        <label className="cd-label">Instrucciones extra (system prompt)</label>
        <textarea
          className="cd-textarea"
          rows={3}
          placeholder="Ej.: Responde siempre en español. Prefiere soluciones simples."
          value={append}
          onChange={(e) => setAppend(e.target.value)}
        />
      </div>
      <div className="params-row">
        <label className="cd-label">Carpetas adicionales con acceso</label>
        {dirs.map((d) => (
          <div key={d} className="params-dir">
            <span title={d}>📁 {d}</span>
            <button className="widget-btn" onClick={() => setDirs((ds) => ds.filter((x) => x !== d))}>
              <IconX size={10} />
            </button>
          </div>
        ))}
        <button
          className="cd-btn cd-btn--ghost"
          onClick={() => {
            void window.deck.pickFolder().then((f) => {
              if (f && !dirs.includes(f)) setDirs((ds) => [...ds, f])
            })
          }}
        >
          + Agregar carpeta
        </button>
      </div>
      <div className="params-note">
        Los cambios aplican a esta pestaña. Claude Code no expone la temperatura de muestreo;
        guardar reinicia la sesión (la conversación continúa con resume).
      </div>
      <div className="params-actions">
        <button className="cd-btn cd-btn--ghost" onClick={p.onClose}>
          Cancelar
        </button>
        <button className="cd-btn cd-btn--primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Aplicando…' : 'Guardar y aplicar'}
        </button>
      </div>
    </div>
  )
}

/**
 * Tarjeta de pregunta de opción múltiple (tool AskUserQuestion): pinta cada
 * pregunta con sus opciones y devuelve {"pregunta": "respuesta"} — igual que
 * el selector interactivo de la consola de Claude Code.
 */
function QuestionCard(p: {
  questions: AskQuestion[]
  onAnswer: (answers: Record<string, string>) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})

  const toggle = (q: AskQuestion, label: string): void => {
    setSelected((s) => {
      const cur = s[q.question] ?? []
      if (q.multiSelect) {
        return {
          ...s,
          [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
        }
      }
      return { ...s, [q.question]: [label] }
    })
  }

  const answered = (q: AskQuestion): boolean =>
    (selected[q.question]?.length ?? 0) > 0 || Boolean(otherText[q.question]?.trim())

  const allAnswered = p.questions.every(answered)

  const submit = (): void => {
    const answers: Record<string, string> = {}
    for (const q of p.questions) {
      const opts = selected[q.question] ?? []
      const other = otherText[q.question]?.trim()
      const parts = [...opts.filter((o) => o !== '__other__'), ...(other ? [other] : [])]
      answers[q.question] = parts.join(', ')
    }
    p.onAnswer(answers)
  }

  return (
    <div className="question-card">
      <div className="perm-title">❓ Claude necesita tu decisión</div>
      {p.questions.map((q) => (
        <div key={q.question} className="question-block">
          <div className="question-head">
            <span className="chip project">{q.header}</span>
            <span className="question-text">{q.question}</span>
            {q.multiSelect && <span className="hint" style={{ margin: 0 }}>(varias opciones)</span>}
          </div>
          <div className="question-options">
            {q.options.map((o) => {
              const sel = (selected[q.question] ?? []).includes(o.label)
              return (
                <button
                  key={o.label}
                  className={`question-option ${sel ? 'sel' : ''}`}
                  onClick={() => toggle(q, o.label)}
                  title={o.description}
                >
                  <b>{o.label}</b>
                  <span>{o.description}</span>
                </button>
              )
            })}
            <input
              type="text"
              className="question-other"
              placeholder="Otra respuesta…"
              value={otherText[q.question] ?? ''}
              onChange={(e) => setOtherText((t) => ({ ...t, [q.question]: e.target.value }))}
            />
          </div>
        </div>
      ))}
      <div className="perm-actions">
        <button className="iconbtn primary" disabled={!allAnswered} onClick={submit}>
          Responder
        </button>
        <button className="iconbtn" onClick={p.onDismiss}>
          Cerrar sin responder
        </button>
      </div>
    </div>
  )
}

/**
 * Título del subagente: tipo + descripción de su tarea, sacados del input del
 * tool Agent/Task. Con regex de respaldo porque el input puede venir truncado
 * y no ser JSON parseable completo.
 */
function subagentTaskLabel(messages: ChatMessage[], toolUseId: string): string {
  for (const m of messages) {
    const tu = m.toolUses.find((t) => t.id === toolUseId)
    if (!tu) continue
    let description = ''
    let type = ''
    try {
      const parsed = JSON.parse(tu.input)
      description = String(parsed.description ?? parsed.prompt ?? '')
      type = String(parsed.subagent_type ?? parsed.name ?? '')
    } catch {
      description =
        tu.input.match(/"description"\s*:\s*"([^"]+)"/)?.[1] ??
        tu.input.match(/"prompt"\s*:\s*"([^"]{1,90})/)?.[1] ??
        ''
      type = tu.input.match(/"subagent_type"\s*:\s*"([^"]+)"/)?.[1] ?? ''
    }
    const label = [type, description].filter(Boolean).join(': ')
    return (label || tu.name).slice(0, 90)
  }
  return 'tarea'
}

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
/** Mensajes renderizados inicialmente; los anteriores se cargan bajo demanda */
const WINDOW_STEP = 60

/**
 * Divide el texto en streaming en párrafos ESTABLES (completos, se parsean a
 * markdown una sola vez gracias al memo) + una cola pendiente que se pinta en
 * plano. Respeta los bloques de código: nunca corta dentro de un fence ```.
 */
function splitStableChunks(text: string): { stable: string[]; tail: string } {
  const stable: string[] = []
  let start = 0
  let searchFrom = 0
  let fencesBefore = 0
  while (true) {
    const idx = text.indexOf('\n\n', searchFrom)
    if (idx < 0) break
    const segment = text.slice(start, idx)
    const fences = (segment.match(/```/g) ?? []).length
    if ((fencesBefore + fences) % 2 === 0) {
      stable.push(segment)
      fencesBefore = 0
      start = idx + 2
    }
    searchFrom = idx + 2
  }
  return { stable, tail: text.slice(start) }
}

/** Streaming incremental: párrafos completos en markdown memoizado + cola plana */
const StreamingBubble = memo(function StreamingBubble(p: { text: string }): React.JSX.Element {
  const { stable, tail } = splitStableChunks(p.text)
  return (
    <div className="bubble assistant">
      {stable.map((chunk, i) => (
        <Markdown key={i} text={chunk} />
      ))}
      {tail && <pre className="stream-plain">{tail}</pre>}
      <span className="cursor">▍</span>
    </div>
  )
})

/**
 * Burbuja memoizada: solo se re-renderiza si SU mensaje cambió (los updates
 * de tool results clonan únicamente el mensaje afectado). Clave para los FPS
 * en conversaciones largas.
 */
const MessageBubble = memo(function MessageBubble(p: {
  message: ChatMessage
  subagentCounts: Record<string, number>
  onOpenSubagent: (id: string) => void
  onOpenImage: (src: string) => void
}): React.JSX.Element {
  const m = p.message
  return (
    <div className={`bubble ${m.role}`} data-mid={m.id}>
      {m.images && m.images.length > 0 && (
        <div className="bubble-images">
          {m.images.map((src, i) => (
            <img key={i} src={src} alt="adjunto" onClick={() => p.onOpenImage(src)} />
          ))}
        </div>
      )}
      {m.role === 'user' ? (
        m.text ? <pre className="user-text">{m.text}</pre> : null
      ) : (
        <Markdown text={m.text} />
      )}
      {m.toolUses
        .filter((tu) => tu.name !== 'TodoWrite')
        .map((tu) => {
          const isAgent =
            tu.name === 'Agent' || tu.name === 'Task' || Boolean(p.subagentCounts[tu.id])
          return (
            <details key={tu.id} className={`tooluse ${tu.isError ? 'error' : ''} ${isAgent ? 'agent' : ''}`}>
              <summary>
                {isAgent ? '🤖' : '🔧'} {tu.name}
                {tu.result === undefined ? ' · ejecutando…' : tu.isError ? ' · ⚠️ error' : ' · ✓'}
                {isAgent && (
                  <button
                    className="subagent-link"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      p.onOpenSubagent(tu.id)
                    }}
                  >
                    <IconEye size={12} /> ver subagente
                    {p.subagentCounts[tu.id] ? ` (${p.subagentCounts[tu.id]})` : ''}
                  </button>
                )}
              </summary>
              <pre>{tu.input}</pre>
              {tu.result !== undefined && <pre className="tool-result">{tu.result}</pre>}
            </details>
          )
        })}
    </div>
  )
},
// Solo re-renderizar si cambió SU mensaje o el conteo de SUS subagentes —
// los conteos de otras burbujas no la tocan.
(prev, next) => {
  if (prev.message !== next.message) return false
  for (const tu of next.message.toolUses) {
    if (prev.subagentCounts[tu.id] !== next.subagentCounts[tu.id]) return false
  }
  return true
})

/** Respaldo si el SDK aún no reporta los modelos (los alias siempre funcionan) */
const FALLBACK_MODELS: ModelOption[] = [
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' }
]

/**
 * Respaldo si el SDK aún no reporta los comandos de la sesión (la lista real
 * de supportedCommands() lo reemplaza en cuanto llega). Solo comandos que
 * funcionan como texto vía SDK — los de diálogo de la TUI (/theme, /ide,
 * /login, /terminal-setup…) se omiten porque aquí no harían nada útil.
 */
const FALLBACK_COMMANDS: SlashCommandInfo[] = [
  { name: '/clear', description: 'Limpiar el historial de la conversación' },
  { name: '/btw', description: 'Pregunta al margen: se responde aparte sin afectar el hilo principal' },
  { name: '/compact', description: 'Resumir mensajes anteriores para liberar contexto' },
  { name: '/context', description: 'Ver el uso de contexto con sugerencias' },
  { name: '/cost', description: 'Estadísticas de uso de tokens' },
  { name: '/usage', description: 'Desglose del uso del plan' },
  { name: '/model', description: 'Ver o cambiar el modelo' },
  { name: '/effort', description: 'Nivel de razonamiento (low/medium/high/xhigh/max)' },
  { name: '/plan', description: 'Entrar en modo plan para cambios grandes' },
  { name: '/goal', description: 'Definir condición de finalización y trabajar hasta cumplirla' },
  { name: '/init', description: 'Inicializar el proyecto con CLAUDE.md' },
  { name: '/memory', description: 'Editar y gestionar archivos de memoria' },
  { name: '/permissions', description: 'Ver o actualizar reglas de permisos' },
  { name: '/mcp', description: 'Gestionar servidores MCP' },
  { name: '/add-dir', description: 'Dar acceso a directorios adicionales' },
  { name: '/cd', description: 'Cambiar el directorio de trabajo de la sesión' },
  { name: '/resume', description: 'Volver a una conversación anterior' },
  { name: '/rewind', description: 'Retroceder a un checkpoint' },
  { name: '/branch', description: 'Crear una rama de la conversación' },
  { name: '/fork', description: 'Copiar la sesión en background y seguir' },
  { name: '/export', description: 'Exportar la conversación como texto' },
  { name: '/copy', description: 'Copiar la última respuesta al portapapeles' },
  { name: '/diff', description: 'Ver los cambios sin commit' },
  { name: '/code-review', description: 'Revisar el diff o un PR en busca de bugs' },
  { name: '/security-review', description: 'Buscar vulnerabilidades en los cambios' },
  { name: '/simplify', description: 'Revisar los cambios por limpieza y eficiencia' },
  { name: '/verify', description: 'Verificar que los cambios funcionan ejecutándolos' },
  { name: '/tasks', description: 'Trabajo en background y estado de subagentes' },
  { name: '/status', description: 'Estado de la cuenta y del sistema' },
  { name: '/doctor', description: 'Diagnosticar la instalación y configuración' },
  { name: '/debug', description: 'Activar logging de debug' },
  { name: '/help', description: 'Ayuda de Claude Code' }
]

/**
 * Vista de chat estilo cliente LLM sobre una sesión del Agent SDK.
 * STOP y Ctrl+C/Esc interrumpen; /clear limpia; '/' autocompleta comandos;
 * las imágenes se adjuntan pegando, arrastrando o con el botón 📎.
 */
export function ChatView(p: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamText, setStreamText] = useState<{ id: string; text: string } | null>(null)
  const [permissions, setPermissions] = useState<PermissionRequestEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [cost, setCost] = useState(0)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [slashSel, setSlashSel] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [subagents, setSubagents] = useState<Record<string, ChatMessage[]>>({})
  const [doneAgents, setDoneAgents] = useState<Record<string, boolean>>({})
  const [agentActivity, setAgentActivity] = useState<Record<string, number>>({})
  const [, setTick] = useState(0)
  const [subagentView, setSubagentView] = useState<string | null>(null)
  const [imageView, setImageView] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuestionRequestEvent[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelSel, setModelSel] = useState(p.tab.model ?? '')
  const [autoModel, setAutoModel] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIdx, setSearchIdx] = useState(0)
  const [windowSize, setWindowSize] = useState(WINDOW_STEP)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Autocrecimiento real del composer: la altura sigue al contenido (también
  // cuando el texto se envuelve sin saltos de línea), con tope y scroll interno.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 168
    el.style.height = `${Math.min(max, el.scrollHeight)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [input])
  const stickToBottom = useRef(true)
  const tabId = p.tab.id

  // Enfocar el input al activar la pestaña
  useEffect(() => {
    if (p.visible) inputRef.current?.focus()
  }, [p.visible])

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistoryLoaded(false)
    const h = await window.deck.chatHistory(tabId)
    setMessages(h)
    setHistoryLoaded(true)
  }, [tabId])

  useEffect(() => {
    void loadHistory()
    void window.deck.chatCommands(tabId).then(setCommands)
    void window.deck.chatModels(tabId).then(setModels)
  }, [tabId, loadHistory])

  // Suscripciones al stream de la sesión
  useEffect(() => {
    const offs = [
      window.deck.onChatStreamStart(({ tabId: id, messageId }) => {
        if (id === tabId) setStreamText({ id: messageId, text: '' })
      }),
      window.deck.onChatDelta(({ tabId: id, messageId, text }) => {
        if (id !== tabId) return
        setStreamText((s) =>
          s && s.id === messageId ? { ...s, text: s.text + text } : { id: messageId, text }
        )
      }),
      window.deck.onChatMessage(({ tabId: id, message }) => {
        if (id !== tabId) return
        setStreamText(null)
        setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message]))
      }),
      window.deck.onChatToolResult(({ tabId: id, toolUseId, result, isError }) => {
        if (id !== tabId) return
        // clonar SOLO el mensaje afectado: el resto conserva identidad y las
        // burbujas memoizadas no se re-renderizan
        setMessages((ms) => {
          const idx = ms.findIndex((m) => m.toolUses.some((tu) => tu.id === toolUseId))
          if (idx < 0) return ms
          const next = [...ms]
          next[idx] = {
            ...ms[idx],
            toolUses: ms[idx].toolUses.map((tu) =>
              tu.id === toolUseId ? { ...tu, result, isError } : tu
            )
          }
          return next
        })
      }),
      window.deck.onChatResult((meta) => {
        if (meta.tabId !== tabId) return
        setBusy(false)
        setStreamText(null)
        setCost(meta.costUsd)
        if (meta.isError && meta.errorText) setError(meta.errorText)
      }),
      window.deck.onChatError(({ tabId: id, message }) => {
        if (id !== tabId) return
        setBusy(false)
        setError(message)
      }),
      window.deck.onChatPermissionRequest((req) => {
        if (req.tabId === tabId) setPermissions((ps) => [...ps, req])
      }),
      window.deck.onChatPermissionCancel(({ tabId: id, requestId }) => {
        if (id === tabId) setPermissions((ps) => ps.filter((x) => x.requestId !== requestId))
      }),
      window.deck.onChatCommands(({ tabId: id, commands }) => {
        if (id === tabId) setCommands(commands)
      }),
      window.deck.onChatModels(({ tabId: id, models }) => {
        if (id === tabId) setModels(models)
      }),
      window.deck.onChatInitModel(({ tabId: id, model }) => {
        if (id === tabId) setAutoModel(model)
      }),
      window.deck.onChatQuestion((req) => {
        if (req.tabId === tabId) setQuestions((qs) => [...qs, req])
      }),
      window.deck.onChatQuestionCancel(({ tabId: id, requestId }) => {
        if (id === tabId) setQuestions((qs) => qs.filter((x) => x.requestId !== requestId))
      }),
      window.deck.onChatTodos(({ tabId: id, todos }) => {
        if (id === tabId) setTodos(todos)
      }),
      window.deck.onChatSubagentBatch(({ tabId: id, batches }) => {
        if (id !== tabId) return
        // lote de 150ms: UNA actualización por ráfaga, con cap por agente
        setSubagents((s) => {
          const next = { ...s }
          for (const b of batches) {
            next[b.parentId] = [...(next[b.parentId] ?? []), ...b.messages].slice(-150)
          }
          return next
        })
        setAgentActivity((a) => {
          const next = { ...a }
          const now = Date.now()
          for (const b of batches) next[b.parentId] = now
          return next
        })
      }),
      window.deck.onChatAgentDone(({ tabId: id, toolUseId }) => {
        if (id === tabId) setDoneAgents((d) => ({ ...d, [toolUseId]: true }))
      }),
      window.deck.onChatSwitched(({ tabId: id }) => {
        if (id !== tabId) return
        // Sesión restaurada desde el historial: estado limpio + repintar
        setStreamText(null)
        setPermissions([])
        setQuestions([])
        setBusy(false)
        setCost(0)
        setError('')
        setTodos([])
        setSubagents({})
        setDoneAgents({})
        setAgentActivity({})
        void loadHistory()
      })
    ]
    return () => offs.forEach((off) => off())
  }, [tabId, loadHistory])

  // Autoscroll anclado al fondo
  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, streamText, permissions, questions])

  const interrupt = useCallback(() => {
    void window.deck.chatInterrupt(tabId)
    setBusy(false)
    setStreamText(null)
  }, [tabId])

  // Ctrl+C (sin selección) y Esc detienen; Ctrl+F busca en la conversación
  useEffect(() => {
    if (!p.visible) return
    const onKey = (e: KeyboardEvent): void => {
      const noSelection = !window.getSelection()?.toString()
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC' && noSelection && busy) {
        e.preventDefault()
        interrupt()
      } else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 30)
      } else if (e.code === 'Escape') {
        if (imageView) setImageView(null)
        else if (subagentView) setSubagentView(null)
        else if (searchOpen) setSearchOpen(false)
        else if (busy && permissions.length === 0) interrupt()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.visible, busy, permissions.length, interrupt, imageView, subagentView, searchOpen])

  // ---------- búsqueda dentro de la conversación ----------

  const searchMatches = useMemo(
    () =>
      searchQuery.trim().length >= 2
        ? messages.filter((m) => m.text.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        : [],
    [messages, searchQuery]
  )

  const jumpToMatch = useCallback(
    (idx: number) => {
      if (searchMatches.length === 0) return
      const wrapped = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length
      setSearchIdx(wrapped)
      const targetMsg = searchMatches[wrapped]
      // si el mensaje quedó fuera de la ventana renderizada, ampliarla primero
      const msgIdx = messages.findIndex((m) => m.id === targetMsg.id)
      const needed = messages.length - msgIdx
      if (needed > windowSize) setWindowSize(needed + 10)
      setTimeout(() => {
        const target = listRef.current?.querySelector(`[data-mid="${targetMsg.id}"]`)
        if (target) {
          stickToBottom.current = false
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
          target.classList.remove('search-flash')
          void (target as HTMLElement).offsetWidth // reinicia la animación
          target.classList.add('search-flash')
        }
      }, 50)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchMatches, messages]
  )

  // ---------- imágenes ----------

  const addFiles = useCallback((files: Iterable<File>) => {
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) continue
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" supera el límite de 5 MB por imagen`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const dataBase64 = dataUrl.split(',')[1] ?? ''
        setAttachments((a) =>
          a.length >= MAX_IMAGES
            ? a
            : [
                ...a,
                {
                  name: file.name || 'imagen',
                  mediaType: file.type as Attachment['mediaType'],
                  dataBase64,
                  dataUrl
                }
              ]
        )
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.items]
      .filter((i) => i.kind === 'file' && IMAGE_TYPES.includes(i.type))
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null)
    if (files.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  // ---------- envío ----------

  const sendText = useCallback(
    (raw: string, atts: Attachment[] = []): void => {
      const text = raw.trim()
      if (!text && atts.length === 0) return
      if (text === '/clear') {
        // limpia el contexto en el SDK y también la vista
        setMessages([])
        setStreamText(null)
        setTodos([])
        setSubagents({})
        setCost(0)
        setError('')
        window.deck.chatSend(tabId, text)
        setBusy(true)
        return
      }
      setMessages((ms) => [
        ...ms,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          text,
          toolUses: [],
          ...(atts.length ? { images: atts.map((a) => a.dataUrl) } : {})
        }
      ])
      setError('')
      setBusy(true)
      stickToBottom.current = true
      window.deck.chatSend(
        tabId,
        text,
        atts.length
          ? atts.map(({ name, mediaType, dataBase64 }) => ({ name, mediaType, dataBase64 }))
          : undefined
      )
    },
    [tabId]
  )

  const send = (): void => {
    if ((!input.trim() && attachments.length === 0) || busy) return
    sendText(input, attachments)
    setInput('')
    setAttachments([])
  }

  // Inserción desde la paleta de comandos (Ctrl+Shift+P)
  useEffect(() => {
    const onInsert = (e: Event): void => {
      const d = (e as CustomEvent).detail as { tabId: string; text: string; submit: boolean }
      if (d.tabId !== tabId) return
      if (d.submit) sendText(d.text)
      else {
        setInput((v) => v + d.text)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('deck:chat-insert', onInsert)
    return () => window.removeEventListener('deck:chat-insert', onInsert)
  }, [tabId, sendText])

  const answerPermission = (req: PermissionRequestEvent, decision: 'allow' | 'always' | 'deny'): void => {
    window.deck.chatPermissionResponse(tabId, req.requestId, decision)
    setPermissions((ps) => ps.filter((x) => x.requestId !== req.requestId))
  }

  const [modeState, setModeState] = useState<PermissionModeId>(p.tab.permissionMode ?? 'default')
  const setMode = (mode: PermissionModeId): void => {
    if (
      mode === 'bypassPermissions' &&
      !confirm('⚡ Auto total aprueba TODAS las acciones sin preguntar (incluyendo comandos). ¿Continuar?')
    ) {
      return
    }
    void window.deck.chatSetPermissionMode(tabId, mode)
    p.tab.permissionMode = mode
    setModeState(mode)
  }

  // ---------- autocompletado de slash commands ----------

  const slashQuery = input.startsWith('/') && !input.includes(' ') && !input.includes('\n')
    ? input.slice(1).toLowerCase()
    : null
  const commandList = commands.length > 0 ? commands : FALLBACK_COMMANDS
  const slashMatches =
    slashQuery !== null && !slashDismissed
      ? commandList
          .map((c) => ({ c, key: c.name.toLowerCase().replace(/^\//, '') }))
          .filter(({ key, c }) => key.includes(slashQuery) || c.description.toLowerCase().includes(slashQuery))
          .sort((a, b) => {
            const ap = a.key.startsWith(slashQuery) ? 0 : 1
            const bp = b.key.startsWith(slashQuery) ? 0 : 1
            return ap - bp || a.key.localeCompare(b.key)
          })
          .map(({ c }) => c)
          .slice(0, 14)
      : []
  const slashOpen = slashMatches.length > 0

  // Recarga perezosa: si al teclear '/' aún no hay comandos del SDK, pedirlos
  useEffect(() => {
    if (slashQuery !== null && commands.length === 0) {
      void window.deck.chatCommands(tabId).then((c) => c.length && setCommands(c))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery !== null, tabId])

  const applySlash = (cmd: SlashCommandInfo): void => {
    const name = cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`
    setInput(`${name} `)
    setSlashSel(0)
    inputRef.current?.focus()
  }

  const onInputKeyDown = (e: React.KeyboardEvent): void => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSel((i) => Math.min(i + 1, slashMatches.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSel((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applySlash(slashMatches[Math.min(slashSel, slashMatches.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const todosPending = todos.filter((t) => t.status !== 'completed').length

  // Re-evaluar la actividad de los agentes cada 15 s (para retirar inactivos)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  // Subagentes detectados en la conversación (tarjetas Agent/Task del hilo).
  // "En ejecución" = sin resultado aún, O con actividad reciente (los agentes
  // en background devuelven el tool_result al lanzarse, no al terminar), y
  // nunca si ya llegó su task-notification de finalización.
  const agentRuns = useMemo(
    () =>
      messages.flatMap((m) =>
        m.toolUses
          .filter(
            (tu) => tu.name === 'Agent' || tu.name === 'Task' || Boolean(subagents[tu.id]?.length)
          )
          .filter((tu) => tu.name !== 'TodoWrite')
          .map((tu) => {
            const recentActivity = Date.now() - (agentActivity[tu.id] ?? 0) < 60_000
            const running =
              !doneAgents[tu.id] && (tu.result === undefined || recentActivity)
            return {
              id: tu.id,
              label: subagentTaskLabel(messages, tu.id),
              running,
              isError: Boolean(tu.isError),
              msgCount: subagents[tu.id]?.length ?? 0
            }
          })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, subagents, doneAgents, agentActivity]
  )

  const subagentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [id, msgs] of Object.entries(subagents)) counts[id] = msgs.length
    return counts
  }, [subagents])

  const visibleMessages = useMemo(
    () => (messages.length > windowSize ? messages.slice(-windowSize) : messages),
    [messages, windowSize]
  )
  const hiddenCount = messages.length - visibleMessages.length

  const openSubagent = useCallback((id: string) => setSubagentView(id), [])
  const openImage = useCallback((src: string) => setImageView(src), [])
  // En el widget solo viven los agentes EN EJECUCIÓN; los terminados salen
  // (su chat sigue accesible desde la tarjeta del mensaje).
  const activeAgents = agentRuns.filter((a) => a.running)
  const runningAgents = activeAgents.length

  // Si arrancan agentes y no existe el widget de actividad, agregarlo solo
  const prevRunning = useRef(0)
  useEffect(() => {
    if (runningAgents > 0 && prevRunning.current === 0 && !p.widgets.some((w) => w.kind === 'agents')) {
      p.onWidgetsChange([
        ...p.widgets,
        { id: `w-agents-${Date.now()}`, kind: 'agents', side: 'right', order: 99, height: 0, config: {} }
      ])
    }
    prevRunning.current = runningAgents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningAgents])

  const [paramsOpen, setParamsOpen] = useState(false)

  return (
    <MarkdownCwd.Provider value={p.tab.cwd}>
    <div
      className="chat-view"
      style={{ display: p.visible ? 'flex' : 'none' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        addFiles(e.dataTransfer.files)
      }}
    >
      <div className="chat-header">
        <div className="mode-seg" title="Modo de permisos de esta pestaña">
          {(Object.keys(MODE_LABEL) as PermissionModeId[]).map((m) => (
            <button
              key={m}
              className={modeState === m ? 'active' : ''}
              onClick={() => setMode(m)}
            >
              {MODE_LABEL[m].replace(/^\S+\s/, '')}
            </button>
          ))}
        </div>
        <select
          className="mode-select"
          value={modelSel}
          onFocus={() => {
            // recarga perezosa: si el SDK aún no reportó los modelos, reintentar
            if (models.length === 0) {
              void window.deck.chatModels(tabId).then((m) => m.length && setModels(m))
            }
          }}
          onChange={(e) => {
            const model = e.target.value
            setModelSel(model)
            p.tab.model = model || undefined
            void window.deck.chatSetModel(tabId, model || undefined)
          }}
          title="Modelo de esta sesión (cambia en vivo)"
        >
          <option value="">Modelo: auto{autoModel ? ` (${autoModel})` : ''}</option>
          {(models.length > 0 ? models : FALLBACK_MODELS).map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </select>
        <span className="params-anchor">
          <button
            className={`iconbtn ${p.tab.llmParams && Object.keys(p.tab.llmParams).length > 0 ? 'primary' : ''}`}
            onClick={() => setParamsOpen((o) => !o)}
            title="Parámetros del LLM: esfuerzo, thinking, límites, system prompt, carpetas"
          >
            <IconTune size={13} />
          </button>
          {paramsOpen && <LlmParamsPopover tab={p.tab} onClose={() => setParamsOpen(false)} />}
        </span>
        <span
          className={`chip ${p.tab.useGlobalConfig === false ? '' : 'project'}`}
          title="¿Esta sesión carga agentes/skills/CLAUDE.md globales de ~/.claude?"
        >
          {p.tab.useGlobalConfig === false ? '🌐 global OFF' : '🌐 global ON'}
        </span>
        {cost > 0 && (
          <span className="chip" title="Costo estimado acumulado de la sesión (lo reporta el SDK)">
            ${cost.toFixed(4)}
          </span>
        )}
        {(todos.length > 0 || runningAgents > 0) && (
          <button
            className={`iconbtn iconlabel ${runningAgents > 0 ? 'agents-live' : ''}`}
            onClick={() => {
              const existing = p.widgets.find((w) => w.kind === 'agents')
              if (existing) p.onWidgetsChange(p.widgets.filter((w) => w.id !== existing.id))
              else
                p.onWidgetsChange([
                  ...p.widgets,
                  { id: `w-agents-${Date.now()}`, kind: 'agents', side: 'right', order: 99, height: 0, config: {} }
                ])
            }}
            title="Mostrar/quitar el widget de actividad (agentes y plan)"
          >
            <IconTasks size={13} />
            {todos.length > 0 && ` ${todos.length - todosPending}/${todos.length}`}
            {runningAgents > 0 && ` · 🤖 ${runningAgents} activo${runningAgents > 1 ? 's' : ''}`}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {busy && (
          <button className="stopbtn iconlabel" onClick={interrupt} title="Detener (Ctrl+C / Esc)">
            <IconStop size={12} /> Detener
          </button>
        )}
      </div>

      {searchOpen && (
        <div className="chat-search">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Buscar en esta conversación… (Enter siguiente, Esc cierra)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') jumpToMatch(e.shiftKey ? searchIdx - 1 : searchIdx + (searchQuery ? 1 : 0))
              if (e.key === 'Escape') setSearchOpen(false)
            }}
          />
          <span className="hint" style={{ margin: 0 }}>
            {searchMatches.length > 0
              ? `${searchIdx + 1} de ${searchMatches.length}`
              : searchQuery.trim().length >= 2
                ? 'sin coincidencias'
                : ''}
          </span>
          <button className="iconbtn" onClick={() => jumpToMatch(searchIdx - 1)} title="Anterior (Shift+Enter)">
            ↑
          </button>
          <button className="iconbtn" onClick={() => jumpToMatch(searchIdx + 1)} title="Siguiente (Enter)">
            ↓
          </button>
          <button className="iconbtn" onClick={() => setSearchOpen(false)} title="Cerrar (Esc)">
            <IconX size={12} />
          </button>
        </div>
      )}
      <div className="chat-main-row">
        <WidgetDock
          side="left"
          widgets={p.widgets}
          tab={p.tab}
          agents={activeAgents}
          todos={todos}
          onOpenSubagent={openSubagent}
          onChange={p.onWidgetsChange}
        />
        <div
          className="chat-list"
          ref={listRef}
          onScroll={() => {
            const el = listRef.current
            if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          }}
        >
          <div className="chat-column">
          {!historyLoaded && <p className="hint">Cargando conversación…</p>}
          {historyLoaded && messages.length === 0 && !streamText && (
            <div className="chat-empty">
              <h2>💬 {p.tab.title}</h2>
              <p>
                Sesión de Claude Code en <code>{p.tab.cwd}</code>. Escribe <code>/</code> para ver
                los comandos disponibles; pega o arrastra imágenes para adjuntarlas.
              </p>
            </div>
          )}
          {hiddenCount > 0 && (
            <button
              className="iconbtn load-earlier"
              onClick={() => setWindowSize((w) => w + WINDOW_STEP * 2)}
            >
              ↑ Cargar mensajes anteriores ({hiddenCount})
            </button>
          )}
          {visibleMessages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              subagentCounts={subagentCounts}
              onOpenSubagent={openSubagent}
              onOpenImage={openImage}
            />
          ))}
          {streamText && <StreamingBubble text={streamText.text} />}
          {permissions.map((req) => (
            <div key={req.requestId} className="permission-card">
              <div className="perm-title">🔐 {req.title ?? `Claude quiere usar ${req.toolName}`}</div>
              {req.description && <div className="hint">{req.description}</div>}
              <details>
                <summary>Ver detalle de la acción</summary>
                <pre>{req.inputPreview}</pre>
              </details>
              <div className="perm-actions">
                <button className="iconbtn primary" onClick={() => answerPermission(req, 'allow')}>
                  ✓ Permitir
                </button>
                {req.canAlwaysAllow && (
                  <button className="iconbtn" onClick={() => answerPermission(req, 'always')}>
                    ✓✓ Permitir siempre
                  </button>
                )}
                <button className="iconbtn danger" onClick={() => answerPermission(req, 'deny')}>
                  ✕ Denegar
                </button>
              </div>
            </div>
          ))}
          {questions.map((req) => (
            <QuestionCard
              key={req.requestId}
              questions={req.questions}
              onAnswer={(answers) => {
                window.deck.chatQuestionResponse(tabId, req.requestId, answers)
                setQuestions((qs) => qs.filter((x) => x.requestId !== req.requestId))
              }}
              onDismiss={() => {
                window.deck.chatQuestionResponse(tabId, req.requestId, null)
                setQuestions((qs) => qs.filter((x) => x.requestId !== req.requestId))
              }}
            />
          ))}
          {error && <div className="validation err">{error}</div>}
          </div>
        </div>

        <WidgetDock
          side="right"
          widgets={p.widgets}
          tab={p.tab}
          agents={activeAgents}
          todos={todos}
          onOpenSubagent={openSubagent}
          onChange={p.onWidgetsChange}
        />
      </div>

      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map((a, i) => (
            <div key={i} className="attach-thumb">
              <img src={a.dataUrl} alt={a.name} onClick={() => setImageView(a.dataUrl)} />
              <button
                className="attach-remove"
                onClick={() => setAttachments((as) => as.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <span className="hint">
            {attachments.length}/{MAX_IMAGES} imágenes
          </span>
        </div>
      )}

      <div className="chat-input">
        {slashOpen && (
          <div className="slash-menu">
            {slashMatches.map((c, i) => (
              <div
                key={c.name}
                className={`slash-item ${i === slashSel ? 'sel' : ''}`}
                onMouseEnter={() => setSlashSel(i)}
                onClick={() => applySlash(c)}
              >
                <b>{c.name.startsWith('/') ? c.name : `/${c.name}`}</b>
                <span>{c.description}</span>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="composer">
          <textarea
            ref={inputRef}
            value={input}
            placeholder="Escribe un mensaje… «/» comandos · Enter envía · Shift+Enter salto"
            rows={1}
            onChange={(e) => {
              setInput(e.target.value)
              setSlashSel(0)
              if (!e.target.value.startsWith('/')) setSlashDismissed(false)
            }}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
          />
          <div className="composer-actions">
            <button
              className="iconbtn"
              onClick={() => fileRef.current?.click()}
              title="Adjuntar imágenes (o pega/arrastra). Una captura 1080p ≈ 1.5-2k tokens"
            >
              <IconPaperclip size={13} />
            </button>
            <button
              className="iconbtn iconlabel"
              onClick={() => window.dispatchEvent(new CustomEvent('deck:open-palette'))}
              title="Paleta de comandos y snippets (Ctrl+Shift+P)"
            >
              <IconCommand size={12} /> Snippets
            </button>
            <span style={{ flex: 1 }} />
            {busy ? (
              <button className="stopbtn iconlabel" onClick={interrupt} title="Detener (Ctrl+C / Esc)">
                <IconStop size={13} /> Detener
              </button>
            ) : (
              <button
                className="iconbtn primary iconlabel"
                onClick={send}
                disabled={!input.trim() && attachments.length === 0}
                title="Enviar (Enter)"
              >
                Enviar <IconSend size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {imageView && (
        <div className="overlay" onMouseDown={() => setImageView(null)}>
          <img className="image-viewer" src={imageView} alt="imagen" />
        </div>
      )}

      {subagentView && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setSubagentView(null)}>
          <div className="modal subagent-modal">
            <div className="modal-head">
              <h3>
                🤖 Subagente ·{' '}
                <span className="hint" style={{ display: 'inline' }}>
                  {subagentTaskLabel(messages, subagentView)}
                </span>
              </h3>
              <button className="iconbtn" onClick={() => setSubagentView(null)}>
                <IconX size={13} />
              </button>
            </div>
            <div className="modal-body subagent-body">
              {(subagents[subagentView] ?? []).length === 0 && (
                <p className="hint">
                  <span className="spinner" /> El subagente está arrancando — aquí verás su
                  actividad en vivo (mensajes y herramientas que use).
                </p>
              )}
              {(subagents[subagentView] ?? []).map((m) => (
                <div key={m.id} className="bubble assistant" style={{ marginBottom: 10 }}>
                  {m.text && <Markdown text={m.text} />}
                  {m.toolUses.map((tu) => (
                    <details key={tu.id} className="tooluse">
                      <summary>🔧 {tu.name}</summary>
                      <pre>{tu.input}</pre>
                    </details>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
    </MarkdownCwd.Provider>
  )
}
