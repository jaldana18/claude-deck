import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type {
  ArtifactDraft,
  ChatAttachment,
  AparteModo,
  ConfigScope,
  HookItem,
  LlmParams,
  PaneLayout,
  PermissionModeId,
  GlobalSettings,
  ProjectPrefs,
  Snippet,
  TabMode,
  TabProfile,
  TabState,
  WidgetState
} from '../shared/types'
import { paneIdsFor, paneTabId } from '../shared/types'
import { trayStatusLabel, trayTooltip } from '../shared/tray'
import { imageMediaType } from '../shared/paths'
import { Store } from './store'
import { PtyManager } from './ptys'
import { SessionTracker } from './sessionTracker'
import { HookServer, installDeckHooks } from './hookServer'
import { invalidateScanCache, listGlobalAgents, scanProject } from './configScanner'
import { toggleHook, toggleItem } from './configToggle'
import { createArtifact, generateDraft, validateArtifact } from './validator'
import { searchChats } from './chatSearch'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { getGitInfo } from './gitPanel'
import { getBuilds, getPullRequests } from './ci'
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
import {
  addMcpServer,
  importAgents,
  importFromUrl,
  importSkill,
  readLocalPluginManifest,
  runPluginCommand
} from './marketplace'

let win: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => win

let tray: Tray | null = null
/** Cierre real en curso: distingue «me voy» de «solo esconde la ventana». */
let quitting = false

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
    ptys.startPane(paneId, tab.cwd, command, store.getProjectPrefs(tab.cwd).shell)
  }
  if (tab.mode !== 'chat' && tab.profile === 'claude') {
    tracker.startTracking(tab.id, tab.cwd)
  }
}

// ---------- Modo bandeja («modo Spotify») ----------

/**
 * Icono para la bandeja. En desarrollo se lee del árbol de fuentes; empaquetada
 * la app, de resources/ (electron-builder lo copia vía extraResources). Si
 * faltara, se devuelve un nativeImage vacío: Windows pinta un hueco pero la app
 * no se cae, y perder el icono no debe impedir que el modo bandeja funcione.
 */
function trayIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../build/icon.ico')
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) return img
  }
  return nativeImage.createEmpty()
}

/** Trae la ventana al frente; si ya no existe, la vuelve a crear. */
function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** Sale de verdad, saltándose la intercepción de la ✕. */
function quitForReal(): void {
  quitting = true
  app.quit()
}

/** Reconstruye tooltip y menú del icono con el número de pestañas vivas. */
function refreshTray(): void {
  if (!tray) return
  const counts = {
    chats: store.tabs.filter((t) => t.mode === 'chat').length,
    terminals: store.tabs.filter((t) => t.mode !== 'chat').length
  }
  tray.setToolTip(trayTooltip(counts))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Claude Deck', click: showWindow },
      { type: 'separator' },
      { label: trayStatusLabel(counts), enabled: false },
      { type: 'separator' },
      { label: 'Salir de Claude Deck', click: quitForReal }
    ])
  )
}

/**
 * El modo bandeja solo cuenta como activo si el icono existe de verdad. Sin esa
 * condición, un fallo al crear el Tray dejaría la ✕ escondiendo la ventana sin
 * nada visible con lo que recuperarla.
 */
function trayActive(): boolean {
  return tray !== null && !tray.isDestroyed()
}

/**
 * Crea o destruye el icono según el ajuste. Se llama al arrancar y cada vez
 * que se guardan los ajustes, así el interruptor tiene efecto inmediato sin
 * reiniciar.
 */
function syncTray(): void {
  const wanted = store.globalSettings.closeToTray === true
  if (wanted && !tray) {
    try {
      tray = new Tray(trayIcon())
      tray.on('click', showWindow)
      tray.on('double-click', showWindow)
      refreshTray()
    } catch {
      tray = null
    }
  } else if (!wanted && tray) {
    tray.destroy()
    tray = null
  } else {
    refreshTray()
  }
}

/**
 * Aviso único la primera vez que la ✕ esconde la app. Sin él, la ventana
 * desaparece y parece que se cerró: el usuario relanza el acceso directo, la
 * instancia única le devuelve la misma ventana y no entiende por qué sus
 * sesiones siguen ahí.
 */
function hintTrayOnce(): void {
  if (!tray || store.globalSettings.trayHintShown) return
  store.setGlobalSettings({ trayHintShown: true })
  try {
    tray.displayBalloon({
      title: 'Claude Deck sigue trabajando',
      content:
        'La ventana se escondió, pero tus sesiones y terminales siguen vivas. Haz clic en este icono para volver.'
    })
  } catch {
    // displayBalloon no está en todas las versiones de Windows; no es crítico
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
  // Modo bandeja: la ✕ esconde en vez de cerrar. No se tocan los PTY ni las
  // sesiones — el renderer sigue montado, solo deja de verse.
  win.on('close', (e) => {
    if (quitting || !trayActive()) return
    e.preventDefault()
    win?.hide()
    hintTrayOnce()
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
      cli?: string
      cliCommand?: string
    }
  ) => {
    const cli = (args.cli ?? 'claude') as TabState['cli']
    const tab: TabState = {
      id: randomUUID(),
      title: args.title || args.cwd.split(/[\\/]/).filter(Boolean).at(-1) || args.cwd,
      cwd: args.cwd,
      // chat: el PTY de la pestaña es el terminal inferior (shell simple);
      // terminal: la TUI del CLI elegido (solo claude usa el perfil 'claude',
      // que activa el tracking de session id y los hooks de estado).
      profile: (args.mode === 'terminal' && cli === 'claude' ? 'claude' : 'shell') as TabProfile,
      mode: args.mode,
      ...(args.mode === 'terminal' ? { cli, cliCommand: args.cliCommand } : {}),
      useGlobalConfig: args.useGlobalConfig,
      permissionMode: args.permissionMode ?? 'default',
      createdAt: Date.now()
    }
    store.addTab(tab)
    refreshTray()
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
  refreshTray()
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
      ptys.startPane(paneId, tab.cwd, command, store.getProjectPrefs(tab.cwd).shell)
    }
  }
  return tab
})

/** Relanza el proceso de un panel concreto */
ipcMain.handle('panes:restart', (_e, paneId: string) => {
  const tab = store.tabs.find((t) => t.id === paneTabId(paneId))
  if (!tab) return
  const command = paneId === tab.id ? ptys.buildCommand(tab) : null
  ptys.startPane(paneId, tab.cwd, command, store.getProjectPrefs(tab.cwd).shell)
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

ipcMain.handle(
  'artifact:draft',
  (_e, args: { kind: 'agent' | 'skill' | 'command'; name: string; description: string }) =>
    generateDraft(args)
)

ipcMain.handle('store:pluginManifest', (_e, dir: string) => readLocalPluginManifest(dir))

// ---------- IPC: CI y pull requests (GitHub / Azure / Bitbucket) ----------

ipcMain.handle('ci:builds', (_e, cwd: string) => getBuilds(cwd))
ipcMain.handle('ci:prs', (_e, cwd: string) => getPullRequests(cwd))

/** Árbol de archivos de un directorio (primer nivel + expansión bajo demanda) */
ipcMain.handle('fs:tree', async (_e, args: { dir: string; depth?: number }) => {
  const { readdirSync, statSync } = await import('node:fs')
  const { join, relative } = await import('node:path')
  interface FsNode { name: string; path: string; isDir: boolean; children?: FsNode[]; gitStatus?: string }
  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'build', '__pycache__', '.cache', 'coverage', '.turbo'])
  const maxDepth = args.depth ?? 1
  function walk(dir: string, depth: number): FsNode[] {
    try {
      return readdirSync(dir)
        .filter(name => !name.startsWith('.') || name === '.env')
        .filter(name => !IGNORE.has(name))
        .sort((a, b) => {
          const aDir = statSync(join(dir, a)).isDirectory()
          const bDir = statSync(join(dir, b)).isDirectory()
          if (aDir !== bDir) return aDir ? -1 : 1
          return a.localeCompare(b, 'es', { sensitivity: 'base' })
        })
        .map(name => {
          const full = join(dir, name)
          const isDir = statSync(full).isDirectory()
          return {
            name,
            path: full,
            isDir,
            children: isDir && depth < maxDepth ? walk(full, depth + 1) : undefined
          }
        })
    } catch { return [] }
  }
  // obtener git status para marcar archivos modificados
  let gitMap: Record<string, string> = {}
  try {
    const { execSync } = await import('node:child_process')
    const raw = execSync('git status --porcelain -uall', { cwd: args.dir, encoding: 'utf-8', timeout: 5000 })
    for (const line of raw.split('\n')) {
      if (line.length < 4) continue
      const status = line.slice(0, 2).trim()
      const file = line.slice(3).trim().replace(/"/g, '')
      gitMap[file] = status
    }
  } catch { /* not a git repo */ }
  const tree = walk(args.dir, 0)
  // annotate git status
  function annotate(nodes: FsNode[], base: string): void {
    for (const n of nodes) {
      const rel = relative(args.dir, n.path).replace(/\\/g, '/')
      if (gitMap[rel]) n.gitStatus = gitMap[rel]
      if (n.children) annotate(n.children, base)
    }
  }
  annotate(tree, args.dir)
  return tree
})

/** Estadísticas de diff del working tree */
ipcMain.handle('fs:diffstats', async (_e, cwd: string) => {
  const { execSync } = await import('node:child_process')
  interface DiffStat { file: string; added: number; removed: number; staged: boolean }
  const parse = (raw: string, staged: boolean): DiffStat[] =>
    raw.split('\n').filter(l => l.trim()).map(line => {
      const [add, del, ...rest] = line.split('\t')
      return {
        file: rest.join('\t'),
        added: add === '-' ? 0 : Number(add),
        removed: del === '-' ? 0 : Number(del),
        staged
      }
    })
  // stderr descartado a propósito: cuando git falla vuelca su ayuda completa
  // (decenas de líneas de opciones) y eso acababa impreso en el widget
  const run = (args: string): string =>
    execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  try {
    run('rev-parse --is-inside-work-tree')
  } catch {
    return { ok: false, stats: [], error: 'Esta carpeta no es un repositorio git.' }
  }
  try {
    return {
      ok: true,
      stats: [...parse(run('diff --numstat'), false), ...parse(run('diff --cached --numstat'), true)]
    }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    const first = msg.split(/\r?\n/)[0]
    return { ok: false, stats: [], error: first }
  }
})

/** Procesos de log por widget (spawn + streaming al renderer) */
const logProcesses = new Map<string, import('node:child_process').ChildProcess>()

ipcMain.handle('logs:spawn', (_e, args: { widgetId: string; command: string; cwd: string }) => {
  const old = logProcesses.get(args.widgetId)
  if (old) { try { old.kill() } catch {} }
  const { spawn: cpSpawn } = require('node:child_process') as typeof import('node:child_process')
  const parts = args.command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [args.command]
  const child = cpSpawn(parts[0], parts.slice(1), {
    cwd: args.cwd,
    shell: true,
    windowsHide: true,
    env: process.env
  })
  logProcesses.set(args.widgetId, child)
  const send = (data: string): void => {
    try {
      const w = getWindow()
      if (w && !w.isDestroyed()) w.webContents.send('logs:data', { widgetId: args.widgetId, data })
    } catch {}
  }
  child.stdout?.on('data', (d: Buffer) => send(d.toString()))
  child.stderr?.on('data', (d: Buffer) => send(d.toString()))
  child.on('exit', (code) => send(`\n--- proceso terminó con código ${code ?? '?'} ---\n`))
  child.on('error', (err) => send(`\n--- error: ${err.message} ---\n`))
  return { ok: true }
})

ipcMain.handle('logs:kill', (_e, widgetId: string) => {
  const child = logProcesses.get(widgetId)
  if (child) { try { child.kill() } catch {} logProcesses.delete(widgetId) }
})

// ---------- IPC: CLIs de agente (claude/codex/gemini/custom) ----------

/** Detecta qué CLIs están en el PATH (where.exe) para el selector */
ipcMain.handle('cli:detect', async () => {
  const check = (exe: string): Promise<boolean> =>
    new Promise((resolve) => {
      const child = spawn('where', [exe], { shell: true, windowsHide: true })
      child.on('close', (code) => resolve(code === 0))
      child.on('error', () => resolve(false))
    })
  const [claude, codex, gemini] = await Promise.all([check('claude'), check('codex'), check('gemini')])
  return [
    { id: 'claude', name: 'Claude Code', available: claude },
    { id: 'codex', name: 'Codex CLI (OpenAI)', available: codex },
    { id: 'gemini', name: 'Gemini CLI (Google)', available: gemini },
    { id: 'custom', name: 'Otro (comando propio)', available: true }
  ]
})

ipcMain.handle('cli:getDefault', () => store.defaultCli)
ipcMain.handle('cli:setDefault', (_e, a: { cli: string; command?: string }) => {
  store.setDefaultCli(a.cli, a.command)
})

/** Extensiones que se abren en VS Code; el resto va a la app predeterminada */
const CODE_EXTS = new Set([
  'md', 'json', 'jsonc', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'less',
  'html', 'htm', 'py', 'yml', 'yaml', 'txt', 'xml', 'cs', 'java', 'kt', 'sql', 'ps1',
  'psm1', 'sh', 'bat', 'cmd', 'toml', 'ini', 'env', 'csv', 'log', 'vue', 'svelte', 'go',
  'rs', 'rb', 'php', 'lock', 'gitignore', 'editorconfig', 'prisma', 'graphql', 'tf'
])

/**
 * Abre lo que el LLM devolvió en el chat: URL → navegador; ruta local de
 * código/texto (o carpeta) → VS Code; binarios (pdf, imágenes…) → app
 * predeterminada del sistema. Las rutas relativas se resuelven contra el cwd
 * de la pestaña.
 */
ipcMain.handle('open:target', async (_e, a: { target: string; cwd?: string }) => {
  const t = a.target.trim()
  if (/^https?:\/\//i.test(t)) {
    await shell.openExternal(t)
    return { ok: true }
  }
  let file = t.replace(/^file:\/{2,3}/i, '')
  if (!isAbsolute(file)) file = join(a.cwd ?? '', file)
  if (!existsSync(file)) return { ok: false, message: `No existe: ${file}` }
  const isDir = statSync(file).isDirectory()
  const ext = extname(file).slice(1).toLowerCase()
  if (isDir || CODE_EXTS.has(ext) || ext === '') {
    // shell:true resuelve el shim code.cmd en Windows; si VS Code no está,
    // cae a la app predeterminada del sistema
    const child = spawn('code', [file], { shell: true, detached: true, stdio: 'ignore' })
    child.on('exit', (code) => {
      if (code !== 0) void shell.openPath(file)
    })
    child.on('error', () => void shell.openPath(file))
    child.unref()
    return { ok: true }
  }
  const err = await shell.openPath(file)
  return err ? { ok: false, message: err } : { ok: true }
})

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Elegir archivos',
    properties: ['openFile', 'multiSelections']
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('artifact:create', (_e, draft: ArtifactDraft) => {
  const res = createArtifact(draft)
  invalidateScanCache()
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
ipcMain.handle('chat:setLlmParams', (_e, a: { tabId: string; params: LlmParams }) =>
  chatSessions.setLlmParams(a.tabId, a.params)
)

// ---------- tienda (MCPs, agentes, skills, plugins) ----------
ipcMain.handle(
  'store:addMcp',
  (
    _e,
    a: {
      scope: ConfigScope
      cwd: string
      name: string
      command: string
      argsList: string[]
      env: Record<string, string>
    }
  ) => addMcpServer(a)
)
ipcMain.handle('store:importAgents', (_e, a: { scope: ConfigScope; cwd: string }) =>
  importAgents(a.scope, a.cwd)
)
ipcMain.handle('store:importSkill', (_e, a: { scope: ConfigScope; cwd: string }) =>
  importSkill(a.scope, a.cwd)
)
ipcMain.handle(
  'store:importUrl',
  (_e, a: { kind: 'agent' | 'skill'; scope: ConfigScope; cwd: string; url: string }) =>
    importFromUrl(a)
)
ipcMain.handle('store:plugin', (_e, a: { args: string[]; cwd: string }) =>
  runPluginCommand(a.args, a.cwd)
)
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

/**
 * Lee un archivo de imagen del disco para adjuntarlo al chat (arrastre desde
 * el widget de Archivos). Solo imágenes: el resto de archivos se mandan como
 * ruta para que Claude los lea bajo demanda y no ocupen contexto para siempre.
 */
ipcMain.handle('file:attach', (_e, path: string): ChatAttachment | null => {
  try {
    const mediaType = imageMediaType(path)
    if (!mediaType) return null
    if (statSync(path).size > 5 * 1024 * 1024) return null
    return {
      name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'imagen',
      mediaType: mediaType as ChatAttachment['mediaType'],
      dataBase64: readFileSync(path).toString('base64')
    }
  } catch {
    return null
  }
})

/** Previsualización (hover) del contenido de un agente/skill/archivo de config */
ipcMain.handle('config:preview', (_e, path: string) => {
  try {
    if (statSync(path).size > 2_000_000) return '(archivo demasiado grande)'
    return readFileSync(path, 'utf8').slice(0, 2200)
  } catch (err) {
    return `(no se pudo leer: ${err})`
  }
})

ipcMain.handle('settings:get', () => store.globalSettings)
ipcMain.handle('settings:set', (_e, settings: GlobalSettings) => {
  store.setGlobalSettings(settings)
  syncTray()
})

/** El renderer necesita saberlo para ofrecer «Salir» de verdad desde la UI. */
ipcMain.handle('app:quit', () => quitForReal())

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

// ---------- IPC: sesión «al margen» (widget Aparte) ----------

/**
 * Arranca la sesión paralela del widget. `asideId` es la clave sintética con la
 * que el widget se suscribe a los eventos `chat:*`, así que reusa `chat:send` y
 * `chat:interrupt` sin necesidad de canales propios.
 */
ipcMain.handle(
  'aparte:start',
  (_e, args: { tabId: string; asideId: string; modo: AparteModo }) => {
    const tab = store.tabs.find((t) => t.id === args.tabId)
    if (!tab) return { ok: false, error: 'La pestaña ya no existe' }
    if (args.modo === 'fork' && !tab.claudeSessionId) {
      return { ok: false, error: 'El chat principal aún no tiene sesión que bifurcar' }
    }
    chatSessions.startAparte(tab, args.asideId, args.modo)
    return { ok: true }
  }
)

ipcMain.handle('aparte:stop', (_e, asideId: string) => {
  chatSessions.stop(asideId)
})

// ---------- IPC: actualización / app ----------

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('update:check', () => updater.check(true))
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
  refreshTray()
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
  // Relanzar el acceso directo estando en la bandeja debe devolver la ventana,
  // no abrir una segunda instancia ni no hacer nada.
  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(() => {
    createWindow()
    syncTray()
    hookServer.start()
    updater.startAutoCheck()
    // Resurrección: relanzar cada pestaña guardada (chat con resume, terminal con --resume)
    for (const tab of store.tabs) startTab(tab)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Con el modo bandeja activo la app sobrevive sin ventanas: sigue viva en la
  // bandeja hasta que se pida salir explícitamente.
  app.on('window-all-closed', () => {
    if (trayActive() && !quitting) return
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    tray?.destroy()
    tray = null
    store.flush()
    ptys.killAll()
    chatSessions.stopAll()
    hookServer.stop()
    void closeBoardClient()
  })
}
