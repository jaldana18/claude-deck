import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import type {
  ArtifactDraft,
  ChatAttachment,
  HookItem,
  PaneLayout,
  PermissionModeId,
  ProjectPrefs,
  Snippet,
  TabMode,
  TabProfile,
  TabState,
  WidgetState
} from '../shared/types'
import { paneIdsFor, paneTabId } from '../shared/types'
import { Store } from './store'
import { PtyManager } from './ptys'
import { SessionTracker } from './sessionTracker'
import { HookServer, installDeckHooks } from './hookServer'
import { listGlobalAgents, scanProject } from './configScanner'
import { toggleHook, toggleItem } from './configToggle'
import { createArtifact, validateArtifact } from './validator'
import { searchChats } from './chatSearch'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { getGitInfo } from './gitPanel'
import {
  closeClient as closeBoardClient,
  getSprintBoard,
  listIterations,
  listProjects,
  listTeams
} from './mcpBoard'
import { ChatSessionManager } from './chatSession'
import { loadChatHistory } from './transcript'
import { Updater, type UpdateInfo } from './updater'

let win: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => win

const store = new Store()
const ptys = new PtyManager(getWindow)
const tracker = new SessionTracker(store, getWindow)
const hookServer = new HookServer(tracker, getWindow)
const chatSessions = new ChatSessionManager(store, getWindow)
const updater = new Updater(getWindow, store)

/** Arranca los procesos de una pestaña según su modo (todos sus paneles) */
function startTab(tab: TabState): void {
  if (tab.mode === 'chat') chatSessions.start(tab)
  const panes = paneIdsFor(tab.id, tab.paneLayout)
  for (const paneId of panes) {
    // solo el panel principal de una pestaña terminal corre la TUI de claude
    const command = paneId === tab.id ? ptys.buildCommand(tab) : null
    ptys.startPane(paneId, tab.cwd, command)
  }
  if (tab.mode !== 'chat' && tab.profile === 'claude') {
    tracker.startTracking(tab.id, tab.cwd)
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'Claude Deck',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('closed', () => {
    win = null
    ptys.detachAll()
  })
  win.on('focus', () => updater.onWindowFocus())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------- IPC: pestañas ----------

ipcMain.handle('tabs:list', () => ({
  tabs: store.tabs,
  activeTabId: store.activeTabId,
  running: store.tabs.map((t) => ({ id: t.id, running: ptys.isRunning(t.id) }))
}))

ipcMain.handle(
  'tabs:create',
  (
    _e,
    args: {
      cwd: string
      mode: TabMode
      title?: string
      useGlobalConfig?: boolean
      permissionMode?: PermissionModeId
    }
  ) => {
    const tab: TabState = {
      id: randomUUID(),
      title: args.title || args.cwd.split(/[\\/]/).filter(Boolean).at(-1) || args.cwd,
      cwd: args.cwd,
      // chat: el PTY de la pestaña es el terminal inferior (shell simple);
      // terminal clásico: el PTY corre la TUI de claude.
      profile: (args.mode === 'chat' ? 'shell' : 'claude') as TabProfile,
      mode: args.mode,
      useGlobalConfig: args.useGlobalConfig,
      permissionMode: args.permissionMode ?? 'default',
      createdAt: Date.now()
    }
    store.addTab(tab)
    startTab(tab)
    return tab
  }
)

ipcMain.handle('tabs:close', (_e, tabId: string) => {
  const tab = store.tabs.find((t) => t.id === tabId)
  ptys.killTabPanes(tabId)
  tracker.stopTracking(tabId)
  chatSessions.stop(tabId)
  for (const paneId of paneIdsFor(tabId, tab?.paneLayout)) store.removeScrollback(paneId)
  store.removeTab(tabId)
  return store.tabs
})

ipcMain.handle('tabs:activate', (_e, tabId: string) => {
  store.setActiveTab(tabId)
})

ipcMain.handle('tabs:rename', (_e, args: { tabId: string; title: string }) => {
  store.updateTab(args.tabId, { title: args.title })
})

/** Relanza los procesos de una pestaña (con resume si hay session id) */
ipcMain.handle('tabs:restart', (_e, tabId: string) => {
  const tab = store.tabs.find((t) => t.id === tabId)
  if (!tab) return
  startTab(tab)
})

ipcMain.handle('tabs:setCwd', (_e, args: { tabId: string; cwd: string }) => {
  const tab = store.updateTab(args.tabId, { cwd: args.cwd, claudeSessionId: undefined })
  if (!tab) return
  chatSessions.stop(tab.id)
  startTab(tab)
  return tab
})

// ---------- IPC: PTY (por panel) ----------

ipcMain.on('pty:input', (_e, args: { paneId: string; data: string }) => {
  ptys.write(args.paneId, args.data)
})

/** Devuelve la salida bufferizada previa al montaje del terminal */
ipcMain.handle('pty:attach', (_e, paneId: string) => ptys.attach(paneId))

ipcMain.on('pty:resize', (_e, args: { paneId: string; cols: number; rows: number }) => {
  ptys.resize(args.paneId, args.cols, args.rows)
})

/** Cambia la distribución de paneles de una pestaña (split estilo Windows Snap) */
ipcMain.handle('panes:set', (_e, args: { tabId: string; layout: PaneLayout }) => {
  const tab = store.updateTab(args.tabId, { paneLayout: args.layout })
  if (!tab) return
  const wanted = new Set(paneIdsFor(tab.id, args.layout))
  // matar los que sobran (y limpiar su scrollback), crear los que faltan
  for (const paneId of paneIdsFor(tab.id, 'grid')) {
    if (!wanted.has(paneId) && ptys.isRunning(paneId)) {
      ptys.kill(paneId)
      store.removeScrollback(paneId)
    }
  }
  for (const paneId of wanted) {
    if (!ptys.isRunning(paneId)) {
      const command = paneId === tab.id ? ptys.buildCommand(tab) : null
      ptys.startPane(paneId, tab.cwd, command)
    }
  }
  return tab
})

/** Relanza el proceso de un panel concreto */
ipcMain.handle('panes:restart', (_e, paneId: string) => {
  const tab = store.tabs.find((t) => t.id === paneTabId(paneId))
  if (!tab) return
  const command = paneId === tab.id ? ptys.buildCommand(tab) : null
  ptys.startPane(paneId, tab.cwd, command)
})

// ---------- IPC: scrollback (por panel) ----------

ipcMain.on('scrollback:save', (_e, args: { paneId: string; data: string }) => {
  store.saveScrollback(args.paneId, args.data)
})

ipcMain.handle('scrollback:load', (_e, paneId: string) => store.loadScrollback(paneId))

// ---------- IPC: config (M2/M3) ----------

ipcMain.handle('config:scan', (_e, cwd: string) => scanProject(cwd))

ipcMain.handle(
  'config:toggle',
  (_e, args: { kind: 'agent' | 'skill' | 'mcp' | 'command'; cwd: string; path: string; name: string; enable: boolean }) => {
    toggleItem(args.kind, args.cwd, args.path, args.name, args.enable)
    return scanProject(args.cwd)
  }
)

ipcMain.handle('config:toggleHook', (_e, args: { hook: HookItem; cwd: string; enable: boolean }) => {
  toggleHook(args.hook, args.cwd, args.enable)
  return scanProject(args.cwd)
})

ipcMain.handle('config:installDeckHooks', (_e, args: { cwd: string; install: boolean }) => {
  installDeckHooks(args.cwd, args.install)
  return scanProject(args.cwd)
})

ipcMain.handle('artifact:validate', (_e, draft: ArtifactDraft) => validateArtifact(draft))

ipcMain.handle('artifact:create', (_e, draft: ArtifactDraft) => {
  const res = createArtifact(draft)
  return { ...res, config: scanProject(draft.cwd) }
})

// ---------- IPC: snippets / búsqueda / diálogos ----------

ipcMain.handle('snippets:list', () => store.snippets)
ipcMain.handle('snippets:save', (_e, snippet: Snippet) => {
  store.saveSnippet(snippet)
  return store.snippets
})
ipcMain.handle('snippets:delete', (_e, id: string) => {
  store.deleteSnippet(id)
  return store.snippets
})

ipcMain.handle('chats:search', (_e, query: string) => searchChats(query))

// ---------- IPC: chat (v2, Agent SDK) ----------

ipcMain.on(
  'chat:send',
  (_e, args: { tabId: string; text: string; attachments?: ChatAttachment[] }) => {
    chatSessions.send(args.tabId, args.text, args.attachments)
  }
)

ipcMain.handle('chat:commands', (_e, tabId: string) => chatSessions.commandsFor(tabId))
ipcMain.handle('chat:models', (_e, tabId: string) => chatSessions.modelsFor(tabId))
ipcMain.handle('chat:health', (_e, tabId: string) => chatSessions.healthFor(tabId))
ipcMain.handle('chat:setModel', (_e, args: { tabId: string; model?: string }) =>
  chatSessions.setModel(args.tabId, args.model)
)

/** Sesiones pasadas del proyecto (historial lateral) */
ipcMain.handle('chat:sessions', async (_e, cwd: string) => {
  try {
    const sessions = await listSessions({ dir: cwd })
    return sessions
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 50)
      .map((s) => ({
        sessionId: s.sessionId,
        summary: s.customTitle || s.summary || s.firstPrompt || '(sin título)',
        firstPrompt: s.firstPrompt,
        lastModified: s.lastModified
      }))
  } catch (err) {
    console.error('chat:sessions:', err)
    return []
  }
})

/** Restaura una sesión pasada en la pestaña actual (equivalente a /resume) */
ipcMain.handle('chat:resumeSession', (_e, args: { tabId: string; sessionId: string }) => {
  const tab = store.tabs.find((t) => t.id === args.tabId)
  if (!tab || tab.mode !== 'chat') return
  chatSessions.stop(tab.id)
  tab.claudeSessionId = args.sessionId
  store.updateTab(tab.id, { claudeSessionId: args.sessionId })
  chatSessions.start(tab)
  win?.webContents.send('chat:switched', { tabId: tab.id })
})

ipcMain.handle('chat:interrupt', (_e, tabId: string) => chatSessions.interrupt(tabId))

ipcMain.on(
  'chat:permission-response',
  (_e, args: { tabId: string; requestId: string; decision: 'allow' | 'always' | 'deny' }) => {
    chatSessions.resolvePermission(args.tabId, args.requestId, args.decision)
  }
)

ipcMain.on(
  'chat:question-response',
  (_e, args: { tabId: string; requestId: string; answers: Record<string, string> | null }) => {
    chatSessions.resolveQuestion(args.tabId, args.requestId, args.answers)
  }
)

ipcMain.handle(
  'chat:setPermissionMode',
  (_e, args: { tabId: string; mode: PermissionModeId }) =>
    chatSessions.setPermissionMode(args.tabId, args.mode)
)

ipcMain.handle('chat:history', async (_e, tabId: string) => {
  const tab = store.tabs.find((t) => t.id === tabId)
  if (!tab?.claudeSessionId) return []
  return loadChatHistory(tab.claudeSessionId, tab.cwd)
})

ipcMain.handle('config:globalAgents', () => listGlobalAgents())

/** Previsualización (hover) del contenido de un agente/skill/archivo de config */
ipcMain.handle('config:preview', (_e, path: string) => {
  try {
    if (statSync(path).size > 2_000_000) return '(archivo demasiado grande)'
    return readFileSync(path, 'utf8').slice(0, 2200)
  } catch (err) {
    return `(no se pudo leer: ${err})`
  }
})

ipcMain.handle('prefs:get', (_e, cwd: string) => store.getProjectPrefs(cwd))
ipcMain.handle('prefs:set', (_e, args: { cwd: string; prefs: ProjectPrefs }) => {
  store.setProjectPrefs(args.cwd, args.prefs)
})

// ---------- IPC: git y board del sprint ----------

ipcMain.handle('git:info', (_e, cwd: string) => getGitInfo(cwd))

ipcMain.handle(
  'board:get',
  (_e, args: { cwd: string; project: string; team: string; iterationId?: string }) =>
    getSprintBoard(args.cwd, args.project, args.team, args.iterationId)
)

ipcMain.handle('board:projects', (_e, cwd: string) => listProjects(cwd))
ipcMain.handle('board:teams', (_e, args: { cwd: string; project: string }) =>
  listTeams(args.cwd, args.project)
)
ipcMain.handle('board:iterations', (_e, args: { cwd: string; project: string; team: string }) =>
  listIterations(args.cwd, args.project, args.team)
)

// ---------- IPC: widgets (por pestaña) ----------

ipcMain.handle('widgets:get', (_e, tabId: string) => store.getTabWidgets(tabId))
ipcMain.handle('widgets:set', (_e, args: { tabId: string; widgets: WidgetState[] }) => {
  store.setTabWidgets(args.tabId, args.widgets)
})

// ---------- IPC: actualización / app ----------

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('update:check', () => updater.check())
ipcMain.handle('update:install', (_e, info: UpdateInfo) => updater.install(info))
ipcMain.handle('update:getDir', () => updater.getDir())
ipcMain.handle('update:setDir', (_e, dir: string) => updater.setDir(dir))

/** Abre un resultado de búsqueda: pestaña de chat nueva reanudando esa sesión */
ipcMain.handle('chats:open', (_e, args: { cwd: string; sessionId: string }) => {
  const prefs = store.getProjectPrefs(args.cwd)
  const tab: TabState = {
    id: randomUUID(),
    title: args.cwd.split(/[\\/]/).filter(Boolean).at(-1) || args.cwd,
    cwd: args.cwd,
    profile: 'shell' as TabProfile,
    mode: 'chat',
    claudeSessionId: args.sessionId,
    useGlobalConfig: prefs.useGlobalConfig,
    permissionMode: 'default',
    createdAt: Date.now()
  }
  store.addTab(tab)
  startTab(tab)
  return tab
})

ipcMain.handle('dialog:pickFolder', async () => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})

// ---------- Ciclo de vida ----------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    hookServer.start()
    updater.startAutoCheck()
    // Resurrección: relanzar cada pestaña guardada (chat con resume, terminal con --resume)
    for (const tab of store.tabs) startTab(tab)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    store.flush()
    ptys.killAll()
    chatSessions.stopAll()
    hookServer.stop()
    void closeBoardClient()
  })
}
