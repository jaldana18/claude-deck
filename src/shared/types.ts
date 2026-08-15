// Tipos compartidos entre main, preload y renderer.

export type TabProfile = 'claude' | 'shell'

/** CLI de agente que corre en las pestañas de terminal */
export type AgentCliId = 'claude' | 'codex' | 'gemini' | 'custom'

export interface CliInfo {
  id: AgentCliId
  name: string
  /** true si el ejecutable está en el PATH de este PC */
  available: boolean
}

/** chat = UI de burbujas sobre el Agent SDK; terminal = TUI clásica en xterm */
export type TabMode = 'chat' | 'terminal'

export type PermissionModeId = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

/** Distribución de paneles de terminal de una pestaña (estilo Windows Snap) */
export type PaneLayout = 'single' | 'cols' | 'rows' | 'grid'

export const PANE_COUNT: Record<PaneLayout, number> = {
  single: 1,
  cols: 2,
  rows: 2,
  grid: 4
}

/**
 * Ids de los paneles de una pestaña. El panel principal usa el propio tabId
 * (retrocompatible con scrollbacks guardados); los extras son `tabId#n`.
 */
export function paneIdsFor(tabId: string, layout: PaneLayout | undefined): string[] {
  const count = PANE_COUNT[layout ?? 'single']
  return Array.from({ length: count }, (_, i) => (i === 0 ? tabId : `${tabId}#${i + 1}`))
}

export function paneTabId(paneId: string): string {
  return paneId.split('#')[0]
}

export interface TabState {
  id: string
  title: string
  cwd: string
  profile: TabProfile
  /** Modo de la pestaña; las de v1 sin campo se tratan como 'terminal' */
  mode?: TabMode
  /** Session id de Claude Code detectado (nombre del .jsonl sin extensión) */
  claudeSessionId?: string
  /** ¿La sesión carga la configuración global de ~/.claude? (agentes, skills, CLAUDE.md) */
  useGlobalConfig?: boolean
  permissionMode?: PermissionModeId
  /** Modelo elegido para la sesión (vacío = el default de la cuenta) */
  model?: string
  /** Distribución de los paneles de terminal; ausente = un solo panel */
  paneLayout?: PaneLayout
  /** Parámetros del LLM de esta pestaña (effort, thinking, límites…) */
  llmParams?: LlmParams
  /** Última salud conocida de la sesión (sobrevive al reinicio de la app) */
  lastHealth?: ChatHealth
  /** CLI de agente de la pestaña terminal (ausente = claude, retrocompatible) */
  cli?: AgentCliId
  /** comando para cli 'custom' (p.ej. `aider --model gpt-5`) */
  cliCommand?: string
  createdAt: number
}

export interface ModelOption {
  value: string
  displayName: string
}

export type ShellId = 'powershell' | 'cmd' | 'bash'

export interface ProjectPrefs {
  /** shell de los paneles de terminal del proyecto (default: PowerShell) */
  shell?: ShellId
  useGlobalConfig?: boolean
  /** Proyecto y equipo de Azure DevOps para el board del sprint */
  azureProject?: string
  azureTeam?: string
}

// ---------- Panel de git (solo visualización) ----------

export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  date: string
  /** refs decoradas: ramas/tags que apuntan a este commit */
  refs: string[]
  subject: string
  /** carril asignado para el grafo */
  lane: number
  /** carriles de los padres extra (merges) */
  mergeLanes: number[]
  /** carriles activos DESPUÉS de este commit (líneas que continúan hacia abajo) */
  activeAfter: number[]
  /** carriles que se cierran en este commit (ramas que confluyen aquí) */
  closes: number[]
}

export interface GitInfo {
  isRepo: boolean
  branch: string
  dirtyCount: number
  branches: { name: string; current: boolean }[]
  commits: GitCommit[]
  error?: string
}

// ---------- Widgets acoplables a los laterales del chat ----------

export type WidgetKind = 'git' | 'board' | 'agents' | 'health' | 'tasks' | 'ci' | 'prs' | 'notes' | 'timer' | 'clipboard' | 'logs' | 'files' | 'diffstats'
export type WidgetSide = 'left' | 'right'

// ---------- CI / Pull requests (multi-proveedor) ----------

export type CiProvider = 'github' | 'azure' | 'bitbucket' | 'none'

export interface CiRepoInfo {
  provider: CiProvider
  owner?: string
  repo?: string
  /** Azure DevOps: organización y proyecto */
  org?: string
  project?: string
}

export interface CiBuild {
  id: string
  name: string
  branch: string
  state: 'success' | 'failed' | 'running' | 'canceled' | 'partial' | 'unknown'
  finishedAt?: string
  url?: string
}

export interface CiPullRequest {
  id: string
  title: string
  author: string
  branch: string
  draft: boolean
  /** aprobado · cambios pedidos · … (según proveedor) */
  reviewState?: string
  checks: 'success' | 'failed' | 'running' | 'unknown'
  url?: string
}

export interface WidgetConfig {
  /** git: ruta del repo a vigilar (puede diferir del cwd del chat) */
  repoPath?: string
  /** board: proyecto/equipo/sprint elegidos */
  project?: string
  team?: string
  iterationId?: string
  iterationName?: string
  /** board: filtrar por responsable ('' o ausente = todos) */
  assignee?: string
  /** notes: contenido del bloc (texto plano o markdown) */
  notes?: string
  /** notes: ver renderizado como markdown en vez de editar */
  notesPreview?: boolean
  /** logs: comando para el widget de logs */
  logsCommand?: string
}

export interface WidgetState {
  id: string
  kind: WidgetKind
  side: WidgetSide
  order: number
  height: number
  /** ancho propio en px (0/ausente = el del dock) */
  width?: number
  /** media columna: dos widgets «half» se acoplan lado a lado en el dock */
  half?: boolean
  config: WidgetConfig
}

/**
 * Parámetros del LLM configurables por pestaña. Claude Code NO expone la
 * temperatura de muestreo: el control real del comportamiento es el esfuerzo
 * de razonamiento (effort) y el presupuesto de thinking. Se aplican al
 * (re)arrancar la sesión — el cambio reinicia con resume y el chat continúa.
 */
export interface LlmParams {
  /** Esfuerzo de razonamiento (default del CLI: high) */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Thinking: undefined = adaptativo (default), 0 = desactivado, >0 = presupuesto fijo en tokens */
  thinkingBudget?: number
  /** Máximo de turnos por consulta (vacío = sin límite) */
  maxTurns?: number
  /** Presupuesto máximo en USD por consulta (vacío = sin límite) */
  maxBudgetUsd?: number
  /** Instrucciones extra que se anexan al system prompt de Claude Code */
  systemPromptAppend?: string
  /** Carpetas adicionales (absolutas) a las que Claude puede acceder */
  additionalDirs?: string[]
  /** Al detenerse por límite de turnos, auto-enviar «continúa» (máx. 5 seguidas) */
  autoContinue?: boolean
  /** % de contexto a partir del cual auto-compactar al cierre del turno (0/ausente = off) */
  autoCompactPct?: number
  /** Umbral absoluto en tokens para auto-compactar; gana sobre el % y sobre el
   *  global. Es el modo preferido: no depende de acertar la ventana del modelo. */
  autoCompactTokens?: number
}

/** Ajustes globales de la app (no por pestaña ni por proyecto) */
export interface GlobalSettings {
  /** Umbral por defecto en tokens para el auto-compact de todas las pestañas
   *  de chat (0/ausente = desactivado). Cada pestaña puede sobreescribirlo. */
  autoCompactTokens?: number
}

/** Resultado genérico de las acciones de la tienda */
export interface StoreResult {
  ok: boolean
  message: string
}

/** Estado de salud de una sesión de chat: contexto ocupado, tokens y costo */
export interface ChatHealth {
  tabId: string
  /** tokens que ocupan la ventana de contexto ahora (entrada + caché del último turno) */
  contextTokens: number
  /** tamaño de la ventana de contexto del modelo activo */
  contextWindow: number
  /** tokens de salida acumulados en lo que va de la sesión */
  outputTokens: number
  /** costo acumulado de la sesión (lo reporta el SDK) */
  costUsd: number
  /** turnos completados */
  numTurns: number
  /** modelo real de la sesión (el que reporta el init) */
  model?: string
  /** hay una compactación en curso: los tokens de arriba son los de ANTES de
   *  compactar y no se refrescan hasta que llega el primer uso posterior */
  compacting?: boolean
  /** consumo de los límites de la suscripción (ventana de 5h, semanal, …) */
  limits?: RateLimitUsage[]
}

/**
 * Consumo de una ventana de límite de la suscripción. Lo reporta el CLI en el
 * evento `rate_limit_event` del SDK, una ventana por evento, así que se
 * acumulan por tipo.
 */
export interface RateLimitUsage {
  /** five_hour = sesión de 5h · seven_day = semanal · seven_day_opus, … */
  type: string
  /** porcentaje consumido, 0-100 */
  pct: number
  /** epoch ms en que se reinicia la ventana */
  resetsAt?: number
  status?: 'allowed' | 'allowed_warning' | 'rejected'
}

export interface AzureListItem {
  id?: string
  name: string
}

// ---------- Board del sprint (Azure DevOps vía MCP) ----------

export interface BoardItem {
  id: number
  title: string
  state: string
  type: string
  assignedTo: string
  points?: number
}

export interface BoardData {
  ok: boolean
  sprintName?: string
  sprintDates?: string
  items: BoardItem[]
  error?: string
}

/** Estado en vivo de una pestaña, derivado de hooks o del proceso */
export type TabStatus = 'working' | 'attention' | 'done' | 'idle' | 'exited'

export interface Snippet {
  id: string
  name: string
  text: string
  /** true = enviar con Enter automáticamente */
  submit: boolean
  /** Si está definido, el snippet solo aplica a ese proyecto */
  projectCwd?: string
}

export type ArtifactKind = 'agent' | 'skill' | 'hook' | 'command'
export type ConfigScope = 'user' | 'project'

export interface ConfigItem {
  kind: 'agent' | 'skill' | 'mcp' | 'command'
  name: string
  description: string
  scope: ConfigScope
  enabled: boolean
  /** Ruta al archivo/carpeta que representa el ítem */
  path: string
  /** true cuando el ítem no puede activarse/desactivarse desde la app */
  readonly?: boolean
}

export interface HookItem {
  kind: 'hook'
  event: string
  matcher: string
  command: string
  scope: ConfigScope
  enabled: boolean
  /** Archivo de settings donde vive (o vivía) la entrada */
  file: string
  /** true para los hooks internos instalados por claude-deck */
  managed?: boolean
}

export interface ClaudeMdInfo {
  scope: ConfigScope
  path: string
  exists: boolean
  bytes: number
  preview: string
}

export interface ProjectConfig {
  cwd: string
  agents: ConfigItem[]
  /** Slash commands personalizados (~/.claude/commands y .claude/commands) */
  commands: ConfigItem[]
  skills: ConfigItem[]
  hooks: HookItem[]
  mcp: ConfigItem[]
  claudeMd: ClaudeMdInfo[]
  /** true si los hooks de notificación de claude-deck están instalados en el proyecto */
  deckHooksInstalled: boolean
}

export interface AgentDraft {
  name: string
  description: string
  prompt: string
  tools?: string
  model?: string
}

export interface SkillDraft {
  name: string
  description: string
  content: string
  /** allowed-tools del SKILL.md (vacío = todas) */
  tools?: string
  /** rutas absolutas de archivos que se copian a la carpeta de la skill */
  attachments?: string[]
}

export interface CommandDraft {
  /** sin el prefijo «/» */
  name: string
  description: string
  template: string
}

/** Manifiesto resumido de un plugin de Claude Code (lectura local) */
export interface PluginManifest {
  ok: boolean
  error?: string
  name?: string
  version?: string
  license?: string
  commands: string[]
  agents: string[]
  hooks: string[]
}

export interface HookDraft {
  event: string
  matcher: string
  command: string
  description: string
}

export type ArtifactDraft =
  | { kind: 'agent'; scope: ConfigScope; cwd: string; data: AgentDraft }
  | { kind: 'skill'; scope: ConfigScope; cwd: string; data: SkillDraft }
  | { kind: 'hook'; scope: ConfigScope; cwd: string; data: HookDraft }
  | { kind: 'command'; scope: ConfigScope; cwd: string; data: CommandDraft }

export interface ValidationResult {
  ok: boolean
  viable: boolean
  puntaje: number
  problemas: string[]
  sugerencias: string[]
  version_mejorada: Record<string, string> | null
  /** Error de infraestructura (claude CLI no disponible, timeout, etc.) */
  error?: string
  raw?: string
}

export interface ChatSearchResult {
  sessionId: string
  cwd: string
  projectDir: string
  file: string
  mtimeMs: number
  matchCount: number
  preview: string
  firstTimestamp?: string
}

export interface TabStatusEvent {
  tabId: string
  status: TabStatus
  detail?: string
}

// ---------- Chat (v2, Agent SDK) ----------

export interface ChatToolUse {
  id: string
  name: string
  /** Input del tool resumido como JSON legible */
  input: string
  /** Resultado (texto) si ya llegó */
  result?: string
  isError?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  toolUses: ChatToolUse[]
  /** data URLs de imágenes adjuntas (para pintarlas en la burbuja) */
  images?: string[]
  /** true mientras el mensaje se está streameando */
  streaming?: boolean
  timestamp?: string
}

/** Imagen adjunta a un mensaje del usuario */
export interface ChatAttachment {
  name: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
}

/** Slash command disponible en la sesión (lo reporta el SDK) */
export interface SlashCommandInfo {
  name: string
  description: string
}

/** Sesión pasada de un proyecto, para el historial lateral */
export interface SessionListItem {
  sessionId: string
  summary: string
  firstPrompt?: string
  lastModified: number
}

/** Pregunta de opción múltiple del tool AskUserQuestion */
export interface AskQuestionOption {
  label: string
  description: string
}

export interface AskQuestion {
  question: string
  header: string
  multiSelect?: boolean
  options: AskQuestionOption[]
}

export interface QuestionRequestEvent {
  tabId: string
  requestId: string
  questions: AskQuestion[]
}

/** Tarea del plan de Claude (espejo del tool TodoWrite) */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface ChatDeltaEvent {
  tabId: string
  messageId: string
  text: string
}

export interface ChatResultMeta {
  tabId: string
  sessionId: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  numTurns: number
  isError: boolean
  errorText?: string
}

export interface PermissionRequestEvent {
  tabId: string
  requestId: string
  toolName: string
  /** Frase completa del permiso ("Claude quiere...") si el SDK la entrega */
  title?: string
  description?: string
  inputPreview: string
  /** true si el SDK trae sugerencias para "permitir siempre" */
  canAlwaysAllow: boolean
}

export interface PermissionResponse {
  tabId: string
  requestId: string
  decision: 'allow' | 'always' | 'deny'
}

export interface GlobalAgentInfo {
  name: string
  description: string
}
