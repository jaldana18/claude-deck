import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ArtifactDraft,
  AzureListItem,
  BoardData,
  ChatAttachment,
  ChatHealth,
  CiBuild,
  CiPullRequest,
  CiRepoInfo,
  CliInfo,
  GitInfo,
  WidgetState,
  AparteModo,
  ChatDeltaEvent,
  ChatMessage,
  ChatResultMeta,
  ChatSearchResult,
  GlobalAgentInfo,
  HookItem,
  LlmParams,
  ModelOption,
  PaneLayout,
  PluginManifest,
  PermissionModeId,
  PermissionRequestEvent,
  ProjectConfig,
  GlobalSettings,
  ProjectPrefs,
  QuestionRequestEvent,
  SessionListItem,
  SlashCommandInfo,
  Snippet,
  StoreResult,
  TabMode,
  TabState,
  TabStatusEvent,
  TodoItem,
  ValidationResult
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener as never)
  return () => ipcRenderer.removeListener(channel, listener as never)
}

const api = {
  // pestañas
  listTabs: (): Promise<{
    tabs: TabState[]
    activeTabId: string | null
    running: { id: string; running: boolean }[]
  }> => ipcRenderer.invoke('tabs:list'),
  createTab: (args: {
    cwd: string
    mode: TabMode
    title?: string
    useGlobalConfig?: boolean
    permissionMode?: PermissionModeId
    cli?: string
    cliCommand?: string
  }): Promise<TabState> => ipcRenderer.invoke('tabs:create', args),
  cliDetect: (): Promise<CliInfo[]> => ipcRenderer.invoke('cli:detect'),
  ciBuilds: (cwd: string): Promise<{ ok: boolean; repo: CiRepoInfo; builds: CiBuild[]; error?: string }> =>
    ipcRenderer.invoke('ci:builds', cwd),
  ciPrs: (cwd: string): Promise<{ ok: boolean; repo: CiRepoInfo; prs: CiPullRequest[]; error?: string }> =>
    ipcRenderer.invoke('ci:prs', cwd),
  cliGetDefault: (): Promise<{ cli?: string; command?: string }> =>
    ipcRenderer.invoke('cli:getDefault'),
  cliSetDefault: (cli: string, command?: string): Promise<void> =>
    ipcRenderer.invoke('cli:setDefault', { cli, command }),
  closeTab: (tabId: string): Promise<TabState[]> => ipcRenderer.invoke('tabs:close', tabId),
  activateTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tabs:activate', tabId),
  renameTab: (tabId: string, title: string): Promise<void> =>
    ipcRenderer.invoke('tabs:rename', { tabId, title }),
  restartTab: (tabId: string): Promise<void> => ipcRenderer.invoke('tabs:restart', tabId),
  setTabCwd: (tabId: string, cwd: string): Promise<TabState | undefined> =>
    ipcRenderer.invoke('tabs:setCwd', { tabId, cwd }),

  // pty (por panel: el panel principal usa el tabId, los splits usan tabId#n)
  ptyInput: (paneId: string, data: string): void =>
    ipcRenderer.send('pty:input', { paneId, data }),
  ptyAttach: (paneId: string): Promise<string> => ipcRenderer.invoke('pty:attach', paneId),
  ptyResize: (paneId: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', { paneId, cols, rows }),
  onPtyData: (cb: (p: { paneId: string; data: string }) => void) => on('pty:data', cb),
  onPtyExit: (cb: (p: { paneId: string; exitCode: number }) => void) => on('pty:exit', cb),
  setPaneLayout: (tabId: string, layout: PaneLayout): Promise<TabState | undefined> =>
    ipcRenderer.invoke('panes:set', { tabId, layout }),
  restartPane: (paneId: string): Promise<void> => ipcRenderer.invoke('panes:restart', paneId),

  // scrollback (por panel)
  saveScrollback: (paneId: string, data: string): void =>
    ipcRenderer.send('scrollback:save', { paneId, data }),
  loadScrollback: (paneId: string): Promise<string> =>
    ipcRenderer.invoke('scrollback:load', paneId),

  // sesiones / estado
  onTabSession: (cb: (p: { tabId: string; sessionId: string }) => void) => on('tab:session', cb),
  onTabStatus: (cb: (p: TabStatusEvent) => void) => on('tab:status', cb),

  // config
  scanConfig: (cwd: string): Promise<ProjectConfig> => ipcRenderer.invoke('config:scan', cwd),
  toggleConfig: (args: {
    kind: 'agent' | 'skill' | 'mcp' | 'command'
    cwd: string
    path: string
    name: string
    enable: boolean
  }): Promise<ProjectConfig> => ipcRenderer.invoke('config:toggle', args),
  toggleHook: (hook: HookItem, cwd: string, enable: boolean): Promise<ProjectConfig> =>
    ipcRenderer.invoke('config:toggleHook', { hook, cwd, enable }),
  installDeckHooks: (cwd: string, install: boolean): Promise<ProjectConfig> =>
    ipcRenderer.invoke('config:installDeckHooks', { cwd, install }),
  validateArtifact: (draft: ArtifactDraft): Promise<ValidationResult> =>
    ipcRenderer.invoke('artifact:validate', draft),
  createArtifact: (draft: ArtifactDraft): Promise<{ path: string; config: ProjectConfig }> =>
    ipcRenderer.invoke('artifact:create', draft),

  // snippets
  listSnippets: (): Promise<Snippet[]> => ipcRenderer.invoke('snippets:list'),
  saveSnippet: (s: Snippet): Promise<Snippet[]> => ipcRenderer.invoke('snippets:save', s),
  deleteSnippet: (id: string): Promise<Snippet[]> => ipcRenderer.invoke('snippets:delete', id),

  // búsqueda
  searchChats: (query: string): Promise<ChatSearchResult[]> =>
    ipcRenderer.invoke('chats:search', query),
  openChat: (cwd: string, sessionId: string): Promise<TabState> =>
    ipcRenderer.invoke('chats:open', { cwd, sessionId }),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),

  // chat (v2, Agent SDK)
  chatSend: (tabId: string, text: string, attachments?: ChatAttachment[]): void =>
    ipcRenderer.send('chat:send', { tabId, text, attachments }),
  chatCommands: (tabId: string): Promise<SlashCommandInfo[]> =>
    ipcRenderer.invoke('chat:commands', tabId),
  chatModels: (tabId: string): Promise<ModelOption[]> => ipcRenderer.invoke('chat:models', tabId),
  chatHealth: (tabId: string): Promise<ChatHealth | null> =>
    ipcRenderer.invoke('chat:health', tabId),
  onChatHealth: (cb: (p: ChatHealth) => void) => on('chat:health', cb),
  onChatAutoContinue: (cb: (p: { tabId: string; count: number }) => void) =>
    on('chat:auto-continue', cb),
  onChatAutoCompact: (
    cb: (p: {
      tabId: string
      /** capped = se agotó el tope de compactaciones automáticas seguidas */
      phase: 'start' | 'done' | 'capped'
      pct: number
      tokens?: number
      count?: number
      max?: number
    }) => void
  ) => on('chat:auto-compact', cb),
  chatSetLlmParams: (tabId: string, params: LlmParams): Promise<void> =>
    ipcRenderer.invoke('chat:setLlmParams', { tabId, params }),

  // tienda (MCPs, agentes, skills, plugins)
  storeAddMcp: (args: {
    scope: 'user' | 'project'
    cwd: string
    name: string
    command: string
    argsList: string[]
    env: Record<string, string>
  }): Promise<StoreResult> => ipcRenderer.invoke('store:addMcp', args),
  storeImportAgents: (scope: 'user' | 'project', cwd: string): Promise<StoreResult> =>
    ipcRenderer.invoke('store:importAgents', { scope, cwd }),
  storeImportSkill: (scope: 'user' | 'project', cwd: string): Promise<StoreResult> =>
    ipcRenderer.invoke('store:importSkill', { scope, cwd }),
  storeImportUrl: (args: {
    kind: 'agent' | 'skill'
    scope: 'user' | 'project'
    cwd: string
    url: string
  }): Promise<StoreResult> => ipcRenderer.invoke('store:importUrl', args),
  storePlugin: (args: string[], cwd: string): Promise<StoreResult> =>
    ipcRenderer.invoke('store:plugin', { args, cwd }),
  storePluginManifest: (dir: string): Promise<PluginManifest> =>
    ipcRenderer.invoke('store:pluginManifest', dir),
  artifactDraft: (args: {
    kind: 'agent' | 'skill' | 'command'
    name: string
    description: string
  }): Promise<string> => ipcRenderer.invoke('artifact:draft', args),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  /** URL → navegador · código/carpeta → VS Code · binarios → app del sistema */
  openTarget: (target: string, cwd?: string): Promise<StoreResult> =>
    ipcRenderer.invoke('open:target', { target, cwd }),
  /** Ruta absoluta de un File arrastrado (Electron ya no expone File.path) */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  chatSetModel: (tabId: string, model?: string): Promise<void> =>
    ipcRenderer.invoke('chat:setModel', { tabId, model }),
  onChatModels: (cb: (p: { tabId: string; models: ModelOption[] }) => void) =>
    on('chat:models', cb),
  onChatInitModel: (cb: (p: { tabId: string; model: string }) => void) =>
    on('chat:init-model', cb),
  chatSessions: (cwd: string): Promise<SessionListItem[]> =>
    ipcRenderer.invoke('chat:sessions', cwd),
  chatResumeSession: (tabId: string, sessionId: string): Promise<void> =>
    ipcRenderer.invoke('chat:resumeSession', { tabId, sessionId }),
  onChatSwitched: (cb: (p: { tabId: string }) => void) => on('chat:switched', cb),
  onChatTodos: (cb: (p: { tabId: string; todos: TodoItem[] }) => void) => on('chat:todos', cb),
  onChatSubagentBatch: (
    cb: (p: { tabId: string; batches: { parentId: string; messages: ChatMessage[] }[] }) => void
  ) => on('chat:subagent-batch', cb),
  onChatAgentDone: (
    cb: (p: { tabId: string; toolUseId: string; status?: string }) => void
  ) => on('chat:agent-done', cb),
  onChatCommands: (cb: (p: { tabId: string; commands: SlashCommandInfo[] }) => void) =>
    on('chat:commands', cb),
  chatInterrupt: (tabId: string): Promise<void> => ipcRenderer.invoke('chat:interrupt', tabId),
  chatPermissionResponse: (
    tabId: string,
    requestId: string,
    decision: 'allow' | 'always' | 'deny'
  ): void => ipcRenderer.send('chat:permission-response', { tabId, requestId, decision }),
  chatSetPermissionMode: (tabId: string, mode: PermissionModeId): Promise<void> =>
    ipcRenderer.invoke('chat:setPermissionMode', { tabId, mode }),
  chatHistory: (tabId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke('chat:history', tabId),
  onChatStreamStart: (cb: (p: { tabId: string; messageId: string }) => void) =>
    on('chat:stream-start', cb),
  onChatDelta: (cb: (p: ChatDeltaEvent) => void) => on('chat:delta', cb),
  onChatMessage: (
    cb: (p: { tabId: string; message: ChatMessage; replacesStreaming: boolean }) => void
  ) => on('chat:message', cb),
  onChatToolResult: (
    cb: (p: { tabId: string; toolUseId: string; result: string; isError: boolean }) => void
  ) => on('chat:tool-result', cb),
  onChatResult: (cb: (p: ChatResultMeta) => void) => on('chat:result', cb),
  onChatError: (cb: (p: { tabId: string; message: string }) => void) => on('chat:error', cb),
  onChatPermissionRequest: (cb: (p: PermissionRequestEvent) => void) =>
    on('chat:permission-request', cb),
  onChatPermissionCancel: (cb: (p: { tabId: string; requestId: string }) => void) =>
    on('chat:permission-cancel', cb),
  chatQuestionResponse: (
    tabId: string,
    requestId: string,
    answers: Record<string, string> | null
  ): void => ipcRenderer.send('chat:question-response', { tabId, requestId, answers }),
  onChatQuestion: (cb: (p: QuestionRequestEvent) => void) => on('chat:question', cb),
  onChatQuestionCancel: (cb: (p: { tabId: string; requestId: string }) => void) =>
    on('chat:question-cancel', cb),

  globalAgents: (): Promise<GlobalAgentInfo[]> => ipcRenderer.invoke('config:globalAgents'),
  configPreview: (path: string): Promise<string> => ipcRenderer.invoke('config:preview', path),

  // widgets nuevos: files, diff, logs
  fsTree: (dir: string, depth?: number): Promise<unknown[]> =>
    ipcRenderer.invoke('fs:tree', { dir, depth }),
  fsDiffStats: (cwd: string): Promise<{ ok: boolean; stats: unknown[]; error?: string }> =>
    ipcRenderer.invoke('fs:diffstats', cwd),
  logsSpawn: (widgetId: string, command: string, cwd: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('logs:spawn', { widgetId, command, cwd }),
  logsKill: (widgetId: string): Promise<void> => ipcRenderer.invoke('logs:kill', widgetId),
  onLogsData: (cb: (p: { widgetId: string; data: string }) => void) => on('logs:data', cb),

  // git y board del sprint
  gitInfo: (cwd: string): Promise<GitInfo> => ipcRenderer.invoke('git:info', cwd),
  boardGet: (cwd: string, project: string, team: string, iterationId?: string): Promise<BoardData> =>
    ipcRenderer.invoke('board:get', { cwd, project, team, iterationId }),
  boardProjects: (cwd: string): Promise<AzureListItem[]> =>
    ipcRenderer.invoke('board:projects', cwd),
  boardTeams: (cwd: string, project: string): Promise<AzureListItem[]> =>
    ipcRenderer.invoke('board:teams', { cwd, project }),
  boardIterations: (
    cwd: string,
    project: string,
    team: string
  ): Promise<{ id: string; name: string; timeFrame?: string }[]> =>
    ipcRenderer.invoke('board:iterations', { cwd, project, team }),

  // widgets (por pestaña)
  widgetsGet: (tabId: string): Promise<WidgetState[]> => ipcRenderer.invoke('widgets:get', tabId),
  widgetsSet: (tabId: string, widgets: WidgetState[]): Promise<void> =>
    ipcRenderer.invoke('widgets:set', { tabId, widgets }),

  // widget «aparte»: sesión paralela a la del chat principal.
  // Para enviar y cortar se usan chatSend/chatInterrupt con el asideId.
  aparteStart: (
    tabId: string,
    asideId: string,
    modo: AparteModo
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('aparte:start', { tabId, asideId, modo }),
  aparteStop: (asideId: string): Promise<void> => ipcRenderer.invoke('aparte:stop', asideId),

  // app / actualización automática
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  updateCheck: (): Promise<{ version: string; installerPath?: string; url?: string } | null> =>
    ipcRenderer.invoke('update:check'),
  updateGetDir: (): Promise<string> => ipcRenderer.invoke('update:getDir'),
  updateSetDir: (dir: string): Promise<void> => ipcRenderer.invoke('update:setDir', dir),
  updateInstall: (info: { version: string; installerPath?: string; url?: string }): Promise<void> =>
    ipcRenderer.invoke('update:install', info),
  onUpdateAvailable: (cb: (info: { version: string; installerPath?: string; url?: string }) => void) =>
    on('update:available', cb),
  onUpdateProgress: (cb: (p: { percent: number }) => void) => on('update:progress', cb),
  /** lee una imagen del disco para adjuntarla (arrastre desde el widget de Archivos) */
  attachFile: (path: string): Promise<ChatAttachment | null> =>
    ipcRenderer.invoke('file:attach', path),
  getGlobalSettings: (): Promise<GlobalSettings> => ipcRenderer.invoke('settings:get'),
  setGlobalSettings: (settings: GlobalSettings): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),
  /** Salida real, saltándose el modo bandeja */
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  getProjectPrefs: (cwd: string): Promise<ProjectPrefs> => ipcRenderer.invoke('prefs:get', cwd),
  setProjectPrefs: (cwd: string, prefs: ProjectPrefs): Promise<void> =>
    ipcRenderer.invoke('prefs:set', { cwd, prefs })
}

export type DeckApi = typeof api

contextBridge.exposeInMainWorld('deck', api)
