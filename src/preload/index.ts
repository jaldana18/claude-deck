import { contextBridge, ipcRenderer } from 'electron'
import type {
  ArtifactDraft,
  AzureListItem,
  BoardData,
  ChatAttachment,
  ChatHealth,
  GitInfo,
  WidgetState,
  ChatDeltaEvent,
  ChatMessage,
  ChatResultMeta,
  ChatSearchResult,
  GlobalAgentInfo,
  HookItem,
  ModelOption,
  PaneLayout,
  PermissionModeId,
  PermissionRequestEvent,
  ProjectConfig,
  ProjectPrefs,
  QuestionRequestEvent,
  SessionListItem,
  SlashCommandInfo,
  Snippet,
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
  }): Promise<TabState> => ipcRenderer.invoke('tabs:create', args),
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

  // app / actualización automática
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  updateCheck: (): Promise<{ version: string; installerPath: string } | null> =>
    ipcRenderer.invoke('update:check'),
  updateGetDir: (): Promise<string> => ipcRenderer.invoke('update:getDir'),
  updateSetDir: (dir: string): Promise<void> => ipcRenderer.invoke('update:setDir', dir),
  updateInstall: (info: { version: string; installerPath: string }): Promise<void> =>
    ipcRenderer.invoke('update:install', info),
  onUpdateAvailable: (cb: (info: { version: string; installerPath: string }) => void) =>
    on('update:available', cb),
  getProjectPrefs: (cwd: string): Promise<ProjectPrefs> => ipcRenderer.invoke('prefs:get', cwd),
  setProjectPrefs: (cwd: string, prefs: ProjectPrefs): Promise<void> =>
    ipcRenderer.invoke('prefs:set', { cwd, prefs })
}

export type DeckApi = typeof api

contextBridge.exposeInMainWorld('deck', api)
