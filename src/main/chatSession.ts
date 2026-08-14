import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import {
  query,
  type Options,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ChatAttachment,
  ChatHealth,
  ChatMessage,
  ChatResultMeta,
  LlmParams,
  ModelOption,
  PermissionModeId,
  SlashCommandInfo,
  TabState,
  TodoItem
} from '../shared/types'
import { TaskMirror } from '../shared/tasks'
import type { Store } from './store'

/**
 * Ruta al CLI de Claude Code. El binario que el SDK trae embebido (~278 MB)
 * se excluye del instalador para no inflarlo, así que en producción se usa el
 * claude ya instalado en el PC (npm global o instalador nativo).
 */
let cachedCliPath: string | null | undefined
function resolveClaudeCli(): string | undefined {
  if (cachedCliPath !== undefined) return cachedCliPath ?? undefined
  const candidates = [
    // dev: binario embebido del SDK en node_modules
    join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'),
    // npm global (instalación típica en Windows)
    join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe'
    ),
    // instalador nativo de Claude Code
    join(homedir(), '.local', 'bin', 'claude.exe')
  ]
  cachedCliPath = candidates.find((c) => existsSync(c)) ?? null
  return cachedCliPath ?? undefined
}

interface PendingPermission {
  resolve: (r: {
    behavior: 'allow' | 'deny'
    message?: string
    updatedInput?: Record<string, unknown>
    updatedPermissions?: PermissionUpdate[]
  }) => void
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
}

/**
 * Una sesión de chat (Agent SDK) por pestaña en modo chat. Siempre en modo
 * streaming input (AsyncGenerator) porque es el único que soporta interrupt()
 * y setPermissionMode() en vivo.
 */
class ChatSession {
  private queue: SDKUserMessage[] = []
  private waiters: (() => void)[] = []
  private closed = false
  private q: Query | null = null
  private abort = new AbortController()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingPermission>()
  /** id del mensaje assistant en streaming actual (solo hilo principal) */
  private streamingId: string | null = null
  /** buffer de deltas: se agrupan y envían cada ~100ms para no ahogar la UI */
  private deltaBuf = ''
  private deltaTimer: NodeJS.Timeout | null = null
  /** buffer de mensajes de subagentes: se agrupan cada ~150ms */
  private subagentBuf = new Map<string, ChatMessage[]>()
  private subagentTimer: NodeJS.Timeout | null = null
  /** slash commands de la sesión (se cargan tras el init) */
  commands: SlashCommandInfo[] = []
  /** modelos disponibles (se cargan tras el init) */
  models: ModelOption[] = []
  /** salud de la sesión: el contexto ocupado lo reporta el usage de cada
   *  mensaje assistant del hilo principal (input + caché = ventana en uso) */
  /** continuaciones automáticas seguidas (se resetea con cada mensaje real) */
  autoContinues = 0
  /** plan de tareas espejado (TodoWrite o TaskCreate/TaskUpdate) */
  private tasks = new TaskMirror()
  /** hay un /compact automático en vuelo (su result dispara la reanudación) */
  private compacting = false
  private ctxTokens = 0
  private ctxWindow = 200_000
  private outTokens = 0
  private costUsd = 0
  private numTurns = 0
  private sessionModel: string | undefined

  constructor(
    private tab: TabState,
    private store: Store,
    private getWindow: () => BrowserWindow | null
  ) {
    // sembrar la salud desde lo persistido: sobrevive al reinicio de la app
    const lh = tab.lastHealth
    if (lh) {
      this.ctxTokens = lh.contextTokens
      this.ctxWindow = lh.contextWindow
      this.outTokens = lh.outputTokens
      this.costUsd = lh.costUsd
      this.numTurns = lh.numTurns
      this.sessionModel = lh.model
    }
  }

  private send(channel: string, payload: unknown): void {
    try {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {
      /* ventana cerrándose */
    }
  }

  private status(status: string, detail?: string): void {
    this.send('tab:status', { tabId: this.tab.id, status, detail })
  }

  health(): ChatHealth {
    return {
      tabId: this.tab.id,
      contextTokens: this.ctxTokens,
      contextWindow: this.ctxWindow,
      outputTokens: this.outTokens,
      costUsd: this.costUsd,
      numTurns: this.numTurns,
      model: this.sessionModel
    }
  }

  private sendHealth(): void {
    this.send('chat:health', this.health())
  }

  /** Publica el plan de tareas al renderer (widgets Tareas y Actividad) */
  private emitTasks(): void {
    this.send('chat:todos', { tabId: this.tab.id, todos: this.tasks.list() })
  }

  private flushSubagents(): void {
    if (this.subagentTimer) {
      clearTimeout(this.subagentTimer)
      this.subagentTimer = null
    }
    if (this.subagentBuf.size === 0) return
    const batches = [...this.subagentBuf.entries()].map(([parentId, messages]) => ({
      parentId,
      messages
    }))
    this.subagentBuf.clear()
    this.send('chat:subagent-batch', { tabId: this.tab.id, batches })
  }

  private flushDelta(): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer)
      this.deltaTimer = null
    }
    if (this.deltaBuf && this.streamingId) {
      this.send('chat:delta', {
        tabId: this.tab.id,
        messageId: this.streamingId,
        text: this.deltaBuf
      })
      this.deltaBuf = ''
    }
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      while (this.queue.length > 0) yield this.queue.shift()!
      if (this.closed) return
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  start(): void {
    const cliPath = resolveClaudeCli()
    // Parámetros del LLM por pestaña. Claude Code no expone temperatura de
    // muestreo: el control disponible es effort/thinking y los límites.
    const lp = this.tab.llmParams ?? {}
    const options: Options = {
      cwd: this.tab.cwd,
      abortController: this.abort,
      includePartialMessages: true,
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      permissionMode: this.tab.permissionMode ?? 'default',
      ...(this.tab.model ? { model: this.tab.model } : {}),
      ...(lp.effort ? { effort: lp.effort } : {}),
      ...(lp.thinkingBudget !== undefined
        ? {
            thinking:
              lp.thinkingBudget === 0
                ? { type: 'disabled' as const }
                : { type: 'enabled' as const, budgetTokens: lp.thinkingBudget }
          }
        : {}),
      ...(lp.maxTurns ? { maxTurns: lp.maxTurns } : {}),
      ...(lp.maxBudgetUsd ? { maxBudgetUsd: lp.maxBudgetUsd } : {}),
      ...(lp.systemPromptAppend
        ? {
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: lp.systemPromptAppend
            }
          }
        : {}),
      ...(lp.additionalDirs?.length ? { additionalDirectories: lp.additionalDirs } : {}),
      // Requerido por el SDK para que 'bypassPermissions' (Auto total) surta
      // efecto — sin esto el modo no se aplica y todo sigue preguntando. La
      // confirmación de seguridad al usuario la hace la UI antes de activarlo.
      allowDangerouslySkipPermissions: true,
      settingSources: this.tab.useGlobalConfig === false
        ? ['project', 'local']
        : ['user', 'project', 'local'],
      ...(this.tab.claudeSessionId ? { resume: this.tab.claudeSessionId } : {}),
      canUseTool: async (toolName, input, opts) => {
        const requestId = opts.requestId ?? randomUUID()
        // Preguntas de opción múltiple: UI dedicada; la respuesta del usuario
        // viaja de vuelta en updatedInput.answers (así funciona el tool).
        if (toolName === 'AskUserQuestion') {
          return await new Promise((resolve) => {
            this.pendingQuestions.set(requestId, {
              resolve: resolve as PendingPermission['resolve'],
              input
            })
            opts.signal.addEventListener('abort', () => {
              if (this.pendingQuestions.delete(requestId)) {
                resolve({ behavior: 'deny', message: 'Pregunta cancelada' })
                this.send('chat:question-cancel', { tabId: this.tab.id, requestId })
              }
            })
            this.status('attention', 'Claude te hizo una pregunta')
            this.send('chat:question', {
              tabId: this.tab.id,
              requestId,
              questions: (input as { questions?: unknown }).questions ?? []
            })
          })
        }
        return await new Promise((resolve) => {
          this.pendingPermissions.set(requestId, {
            resolve: resolve as PendingPermission['resolve'],
            input,
            suggestions: opts.suggestions
          })
          opts.signal.addEventListener('abort', () => {
            if (this.pendingPermissions.delete(requestId)) {
              resolve({ behavior: 'deny', message: 'Operación cancelada' })
              this.send('chat:permission-cancel', { tabId: this.tab.id, requestId })
            }
          })
          this.status('attention', `Claude pide permiso para ${toolName}`)
          this.send('chat:permission-request', {
            tabId: this.tab.id,
            requestId,
            toolName,
            title: opts.title,
            description: opts.description,
            inputPreview: safeJson(input, 1600),
            canAlwaysAllow: Boolean(opts.suggestions?.length)
          })
        })
      }
    }

    this.q = query({ prompt: this.input(), options })
    void this.run()
  }

  private async run(): Promise<void> {
    if (!this.q) return
    try {
      for await (const msg of this.q) {
        // Mensajes de subagentes: se capturan aparte para el visor por tool_use
        if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) {
          if (msg.type === 'assistant') {
            const chat = toChatMessage(msg.uuid, msg.message)
            if (chat) {
              const arr = this.subagentBuf.get(msg.parent_tool_use_id) ?? []
              arr.push(chat)
              this.subagentBuf.set(msg.parent_tool_use_id, arr)
              if (!this.subagentTimer) {
                this.subagentTimer = setTimeout(() => this.flushSubagents(), 150)
              }
            }
          }
          continue
        }

        if (msg.type === 'stream_event') {
          const ev = msg.event as { type: string; delta?: { type?: string; text?: string } }
          if (ev.type === 'message_start') {
            this.streamingId = randomUUID()
            this.send('chat:stream-start', { tabId: this.tab.id, messageId: this.streamingId })
          } else if (
            ev.type === 'content_block_delta' &&
            ev.delta?.type === 'text_delta' &&
            ev.delta.text &&
            this.streamingId
          ) {
            this.deltaBuf += ev.delta.text
            if (!this.deltaTimer) {
              this.deltaTimer = setTimeout(() => this.flushDelta(), 100)
            }
          }
        } else if (msg.type === 'assistant') {
          // El usage de cada mensaje assistant refleja la ventana de contexto
          // en uso: input + tokens servidos/creados en caché de ese request.
          const usage = (msg.message as {
            usage?: {
              input_tokens?: number
              cache_read_input_tokens?: number
              cache_creation_input_tokens?: number
              output_tokens?: number
            }
          }).usage
          if (usage) {
            this.ctxTokens =
              (usage.input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0)
            this.outTokens += usage.output_tokens ?? 0
            this.sendHealth()
          }
          const chat = toChatMessage(msg.uuid, msg.message)
          if (chat) {
            // Espejo del plan de tareas. Claude Code planifica de dos formas
            // según versión: TodoWrite (lista completa en cada llamada) o el
            // sistema de tareas TaskCreate/TaskUpdate (incremental). Se
            // soportan ambas para que el widget nunca quede vacío.
            const content = (msg.message as { content?: unknown }).content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block?.type !== 'tool_use') continue
                if (block.name === 'TodoWrite') {
                  const todos = (block.input as { todos?: TodoItem[] })?.todos
                  if (Array.isArray(todos)) {
                    this.tasks.applyTodoWrite(todos)
                    this.emitTasks()
                  }
                } else if (block.name === 'TaskCreate') {
                  // el id real llega en el tool_result («Task #12 created…»)
                  this.tasks.noteCreate(String(block.id), block.input as { subject?: string })
                } else if (block.name === 'TaskUpdate') {
                  if (this.tasks.applyUpdate(block.input as { taskId?: string })) this.emitTasks()
                }
              }
            }
            this.flushDelta()
            this.send('chat:message', { tabId: this.tab.id, message: chat, replacesStreaming: true })
          }
          this.streamingId = null
          this.deltaBuf = ''
        } else if (msg.type === 'user') {
          // tool_results del turno (el SDK re-emite el user message sintético)
          const content = (msg.message as { content?: unknown }).content
          if (Array.isArray(content)) {
            for (const block of content) {
              // Los agentes en background terminan con una <task-notification>:
              // es la señal fiable de que ESE agente acabó.
              if (block?.type === 'text' && typeof block.text === 'string' && block.text.includes('<task-notification>')) {
                const toolUseId = block.text.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1]
                const status = block.text.match(/<status>([^<]+)<\/status>/)?.[1]
                if (toolUseId) {
                  this.send('chat:agent-done', { tabId: this.tab.id, toolUseId, status })
                }
              }
              if (block?.type === 'tool_result') {
                const resultText = extractBlockText(block.content)
                // Resultado de un TaskCreate: trae el id real («Task #12 created»)
                if (this.tasks.resolveCreate(String(block.tool_use_id), resultText)) {
                  this.emitTasks()
                }
                this.send('chat:tool-result', {
                  tabId: this.tab.id,
                  toolUseId: block.tool_use_id,
                  result: resultText.slice(0, 4000),
                  isError: Boolean(block.is_error)
                })
              }
            }
          }
        } else if (msg.type === 'system' && msg.subtype === 'init') {
          this.updateSession((msg as { session_id?: string }).session_id)
          const initModel = (msg as { model?: string }).model
          if (initModel) {
            this.sessionModel = initModel
            // Los modelos con contexto de 1M llevan el sufijo [1m] en su id
            this.ctxWindow = /\[1m\]/i.test(initModel) ? 1_000_000 : 200_000
            this.send('chat:init-model', { tabId: this.tab.id, model: initModel })
          }
          void this.loadCommands()
          void this.loadModels()
        } else if (msg.type === 'result') {
          this.updateSession(msg.session_id)
          const meta: ChatResultMeta = {
            tabId: this.tab.id,
            sessionId: msg.session_id,
            costUsd: 'total_cost_usd' in msg ? msg.total_cost_usd : 0,
            inputTokens: 'usage' in msg ? (msg.usage?.input_tokens ?? 0) : 0,
            outputTokens: 'usage' in msg ? (msg.usage?.output_tokens ?? 0) : 0,
            numTurns: msg.num_turns,
            isError: msg.is_error,
            errorText: msg.subtype !== 'success' ? msg.subtype : undefined
          }
          this.send('chat:result', meta)
          this.costUsd = 'total_cost_usd' in msg ? msg.total_cost_usd : this.costUsd
          this.numTurns = msg.num_turns
          this.sendHealth()
          // persistir la salud: el widget la recupera tras reiniciar la app
          this.store.updateTab(this.tab.id, { lastHealth: this.health() })
          // Auto-compact parametrizable: al cerrar el turno, si el contexto
          // superó el umbral, se envía /compact; el result del compact dispara
          // la instrucción de retomar el proceso si lo había.
          const compactPct = this.tab.llmParams?.autoCompactPct
          const usedPct = this.ctxWindow > 0 ? (this.ctxTokens / this.ctxWindow) * 100 : 0
          if (this.compacting) {
            this.compacting = false
            setTimeout(() => {
              if (this.closed) return
              this.send('chat:auto-compact', { tabId: this.tab.id, phase: 'done', pct: 0 })
              this.sendUserText(
                'El contexto acaba de ser compactado automáticamente. Si había un proceso o tarea en curso, continúa exactamente donde quedó sin repetir trabajo ya hecho; si no había nada pendiente, responde únicamente «Listo».'
              )
            }, 800)
          } else if (compactPct && usedPct >= compactPct && !this.closed) {
            this.compacting = true
            const pct = Math.round(usedPct)
            setTimeout(() => {
              if (this.closed) return
              this.send('chat:auto-compact', { tabId: this.tab.id, phase: 'start', pct })
              this.sendUserText('/compact')
            }, 800)
          } else if (
            // Auto-continuación: si se detuvo por límite de TURNOS y el usuario
            // la activó, re-inyectar la instrucción (tope 5 para evitar bucles).
            // Nunca aplica al límite de presupuesto USD: ese tope es de seguridad.
            msg.subtype === 'error_max_turns' &&
            this.tab.llmParams?.autoContinue &&
            this.autoContinues < 5 &&
            !this.closed
          ) {
            this.autoContinues++
            const n = this.autoContinues
            setTimeout(() => {
              if (this.closed) return
              this.send('chat:auto-continue', { tabId: this.tab.id, count: n })
              this.sendUserText(
                'Continúa con el proceso exactamente donde quedaste. No repitas trabajo ya hecho; retoma la siguiente acción pendiente.'
              )
            }, 800)
          }
          this.status('done', 'Claude terminó')
        }
      }
    } catch (err) {
      if (!this.closed) {
        this.send('chat:error', { tabId: this.tab.id, message: friendlyError(err) })
        this.status('exited')
      }
    }
  }

  private updateSession(sessionId?: string): void {
    if (sessionId && sessionId !== this.tab.claudeSessionId) {
      this.tab.claudeSessionId = sessionId
      this.store.updateTab(this.tab.id, { claudeSessionId: sessionId })
      this.send('tab:session', { tabId: this.tab.id, sessionId })
    }
  }

  private async loadCommands(attempt = 0): Promise<void> {
    try {
      const cmds = await this.q?.supportedCommands()
      if (cmds?.length) {
        this.commands = cmds.map((c: { name: string; description?: string }) => ({
          name: c.name,
          description: c.description ?? ''
        }))
        this.send('chat:commands', { tabId: this.tab.id, commands: this.commands })
        return
      }
    } catch (err) {
      console.error(`supportedCommands (intento ${attempt + 1}):`, err)
    }
    // El control request puede no estar listo justo tras el init: reintentar
    if (attempt < 3 && !this.closed) {
      setTimeout(() => void this.loadCommands(attempt + 1), 4000 * (attempt + 1))
    }
  }

  private async loadModels(attempt = 0): Promise<void> {
    try {
      const models = await this.q?.supportedModels()
      if (models?.length) {
        this.models = models.map((m) => ({ value: m.value, displayName: m.displayName }))
        this.send('chat:models', { tabId: this.tab.id, models: this.models })
        return
      }
    } catch (err) {
      console.error(`supportedModels (intento ${attempt + 1}):`, err)
    }
    if (attempt < 3 && !this.closed) {
      setTimeout(() => void this.loadModels(attempt + 1), 4000 * (attempt + 1))
    }
  }

  async setModel(model: string | undefined): Promise<void> {
    this.tab.model = model
    this.store.updateTab(this.tab.id, { model })
    try {
      await this.q?.setModel(model)
    } catch (err) {
      console.error('setModel:', err)
    }
  }

  sendUserText(text: string, attachments?: ChatAttachment[]): void {
    const content =
      attachments && attachments.length > 0
        ? [
            ...(text.trim() ? [{ type: 'text' as const, text }] : []),
            ...attachments.map((a) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: a.mediaType, data: a.dataBase64 }
            }))
          ]
        : text
    this.queue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null
    })
    this.waiters.splice(0).forEach((w) => w())
    this.status('working')
  }

  async interrupt(): Promise<void> {
    try {
      await this.q?.interrupt()
      this.status('idle', 'Interrumpido')
    } catch (err) {
      console.error('interrupt:', err)
    }
  }

  /** true si el cambio en vivo funcionó; false = hay que reiniciar la sesión */
  async setPermissionMode(mode: PermissionModeId): Promise<boolean> {
    this.tab.permissionMode = mode
    this.store.updateTab(this.tab.id, { permissionMode: mode })
    try {
      await this.q?.setPermissionMode(mode)
      return true
    } catch (err) {
      console.error('setPermissionMode:', err)
      return false
    }
  }

  resolvePermission(requestId: string, decision: 'allow' | 'always' | 'deny'): void {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return
    this.pendingPermissions.delete(requestId)
    if (decision === 'deny') {
      pending.resolve({
        behavior: 'deny',
        message: 'El usuario denegó esta acción desde Claude Deck'
      })
    } else {
      pending.resolve({
        behavior: 'allow',
        updatedInput: pending.input,
        ...(decision === 'always' && pending.suggestions?.length
          ? { updatedPermissions: pending.suggestions }
          : {})
      })
    }
    this.status('working')
  }

  /** Respuestas del usuario a AskUserQuestion: {"pregunta": "opción elegida"} */
  resolveQuestion(requestId: string, answers: Record<string, string> | null): void {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return
    this.pendingQuestions.delete(requestId)
    if (!answers) {
      pending.resolve({ behavior: 'deny', message: 'El usuario cerró la pregunta sin responder' })
    } else {
      pending.resolve({
        behavior: 'allow',
        updatedInput: { ...pending.input, answers }
      })
    }
    this.status('working')
  }

  stop(): void {
    this.closed = true
    // timers de batching: sin esto quedaban callbacks apuntando a una pestaña
    // ya cerrada (hasta 150 ms) y podían intentar enviar a una ventana muerta
    if (this.deltaTimer) clearTimeout(this.deltaTimer)
    if (this.subagentTimer) clearTimeout(this.subagentTimer)
    this.deltaTimer = null
    this.subagentTimer = null
    for (const [id, p] of this.pendingPermissions) {
      p.resolve({ behavior: 'deny', message: 'Pestaña cerrada' })
      this.pendingPermissions.delete(id)
    }
    for (const [id, p] of this.pendingQuestions) {
      p.resolve({ behavior: 'deny', message: 'Pestaña cerrada' })
      this.pendingQuestions.delete(id)
    }
    this.waiters.splice(0).forEach((w) => w())
    this.abort.abort()
  }
}

export class ChatSessionManager {
  private sessions = new Map<string, ChatSession>()

  constructor(
    private store: Store,
    private getWindow: () => BrowserWindow | null
  ) {}

  start(tab: TabState): void {
    this.stop(tab.id)
    const session = new ChatSession(tab, this.store, this.getWindow)
    this.sessions.set(tab.id, session)
    session.start()
  }

  send(tabId: string, text: string, attachments?: ChatAttachment[]): void {
    const session = this.sessions.get(tabId)
    if (!session) return
    // mensaje real del usuario: resetea el contador de auto-continuaciones
    session.autoContinues = 0
    session.sendUserText(text, attachments)
  }

  commandsFor(tabId: string): SlashCommandInfo[] {
    return this.sessions.get(tabId)?.commands ?? []
  }

  modelsFor(tabId: string): ModelOption[] {
    return this.sessions.get(tabId)?.models ?? []
  }

  healthFor(tabId: string): ChatHealth | null {
    return this.sessions.get(tabId)?.health() ?? null
  }

  async setModel(tabId: string, model: string | undefined): Promise<void> {
    await this.sessions.get(tabId)?.setModel(model)
  }

  /** Persiste los parámetros del LLM y reinicia la sesión con resume para
   *  aplicarlos (la conversación continúa donde iba). */
  setLlmParams(tabId: string, params: LlmParams): void {
    const tab = this.store.tabs.find((t) => t.id === tabId)
    if (!tab) return
    tab.llmParams = params
    this.store.updateTab(tabId, { llmParams: params })
    if (this.sessions.has(tabId)) this.start(tab)
  }

  async interrupt(tabId: string): Promise<void> {
    await this.sessions.get(tabId)?.interrupt()
  }

  async setPermissionMode(tabId: string, mode: PermissionModeId): Promise<void> {
    const session = this.sessions.get(tabId)
    if (!session) return
    const ok = await session.setPermissionMode(mode)
    if (!ok) {
      // El CLI rechazó el cambio en vivo: reiniciar la sesión con resume para
      // que el nuevo modo aplique desde el arranque (la conversación continúa).
      const tab = this.store.tabs.find((t) => t.id === tabId)
      if (tab) this.start(tab)
    }
  }

  resolvePermission(tabId: string, requestId: string, decision: 'allow' | 'always' | 'deny'): void {
    this.sessions.get(tabId)?.resolvePermission(requestId, decision)
  }

  resolveQuestion(tabId: string, requestId: string, answers: Record<string, string> | null): void {
    this.sessions.get(tabId)?.resolveQuestion(requestId, answers)
  }

  isActive(tabId: string): boolean {
    return this.sessions.has(tabId)
  }

  stop(tabId: string): void {
    this.sessions.get(tabId)?.stop()
    this.sessions.delete(tabId)
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id)
  }
}

// ---------- helpers ----------

function safeJson(v: unknown, max: number): string {
  try {
    const s = JSON.stringify(v, null, 2) ?? ''
    return s.length > max ? s.slice(0, max) + '\n…' : s
  } catch {
    return String(v)
  }
}

function extractBlockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b?.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('\n')
  }
  return ''
}

/** Convierte un BetaMessage del SDK a nuestro ChatMessage (texto + tool uses) */
export function toChatMessage(uuid: string, message: unknown): ChatMessage | null {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  let text = ''
  const toolUses: ChatMessage['toolUses'] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      text += (text ? '\n' : '') + block.text
    } else if (block?.type === 'tool_use') {
      toolUses.push({
        id: String(block.id ?? randomUUID()),
        name: String(block.name ?? 'tool'),
        input: safeJson(block.input, 1200)
      })
    }
  }
  if (!text && toolUses.length === 0) return null
  return { id: uuid, role: 'assistant', text, toolUses }
}

function friendlyError(err: unknown): string {
  const s = String(err)
  if (s.includes('ENOENT') || s.includes('not found')) {
    return 'No se encontró el CLI de Claude Code. Verifica que `claude` esté instalado y en el PATH.'
  }
  return s.slice(0, 600)
}
