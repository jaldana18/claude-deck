import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectPrefs, Snippet, TabState, WidgetState } from '../shared/types'

interface DeckState {
  tabs: TabState[]
  activeTabId: string | null
  snippets: Snippet[]
  /** Preferencias recordadas por proyecto (clave: cwd normalizado en minúsculas) */
  projectPrefs: Record<string, ProjectPrefs>
  /** Widgets por pestaña (cada chat tiene su propio layout) */
  tabWidgets: Record<string, WidgetState[]>
  /** Layout global antiguo (pre-0.9.1): se usa como plantilla para pestañas nuevas */
  widgets?: WidgetState[]
  /** Carpeta donde se buscan instaladores nuevos (compartida de equipo o local) */
  updateDir?: string
}

const DEFAULT_WIDGETS: WidgetState[] = [
  { id: 'w-agents', kind: 'agents', side: 'right', order: 0, height: 320, config: {} }
]

const DEFAULT_SNIPPETS: Snippet[] = [
  { id: 'snip-ultrathink', name: 'ultrathink (razonamiento profundo)', text: 'ultrathink ', submit: false },
  { id: 'snip-resume', name: '/resume — reanudar otra sesión', text: '/resume', submit: true },
  { id: 'snip-clear', name: '/clear — limpiar contexto', text: '/clear', submit: true },
  { id: 'snip-compact', name: '/compact — compactar contexto', text: '/compact', submit: true },
  { id: 'snip-review', name: '/code-review de los cambios', text: '/code-review', submit: true }
]

/**
 * Persistencia estilo Notepad: un JSON con las pestañas/snippets en userData
 * y un archivo por pestaña para el scrollback serializado del terminal.
 */
export class Store {
  private state: DeckState
  private file: string
  private scrollDir: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    const dir = app.getPath('userData')
    this.file = join(dir, 'deck-state.json')
    this.scrollDir = join(dir, 'scrollback')
    mkdirSync(this.scrollDir, { recursive: true })
    this.state = this.load()
  }

  private load(): DeckState {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as DeckState
        return {
          tabs: parsed.tabs ?? [],
          activeTabId: parsed.activeTabId ?? null,
          snippets: parsed.snippets?.length ? parsed.snippets : DEFAULT_SNIPPETS,
          projectPrefs: parsed.projectPrefs ?? {},
          tabWidgets: parsed.tabWidgets ?? {},
          widgets: parsed.widgets
        }
      }
    } catch (err) {
      console.error('No se pudo leer deck-state.json:', err)
    }
    return {
      tabs: [],
      activeTabId: null,
      snippets: DEFAULT_SNIPPETS,
      projectPrefs: {},
      tabWidgets: {}
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 300)
  }

  flush(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8')
    } catch (err) {
      console.error('No se pudo guardar deck-state.json:', err)
    }
  }

  get tabs(): TabState[] {
    return this.state.tabs
  }

  get activeTabId(): string | null {
    return this.state.activeTabId
  }

  setActiveTab(id: string | null): void {
    this.state.activeTabId = id
    this.scheduleSave()
  }

  addTab(tab: TabState): void {
    this.state.tabs.push(tab)
    this.state.activeTabId = tab.id
    this.scheduleSave()
  }

  updateTab(id: string, patch: Partial<TabState>): TabState | undefined {
    const tab = this.state.tabs.find((t) => t.id === id)
    if (!tab) return undefined
    Object.assign(tab, patch)
    this.scheduleSave()
    return tab
  }

  removeTab(id: string): void {
    this.state.tabs = this.state.tabs.filter((t) => t.id !== id)
    delete this.state.tabWidgets[id]
    if (this.state.activeTabId === id) {
      this.state.activeTabId = this.state.tabs.at(-1)?.id ?? null
    }
    try {
      rmSync(this.scrollbackFile(id), { force: true })
    } catch {
      /* ignore */
    }
    this.scheduleSave()
  }

  private scrollbackFile(tabId: string): string {
    // los paneId extra tienen forma `tabId#n`: sanear para el nombre de archivo
    return join(this.scrollDir, `${tabId.replace(/[^a-zA-Z0-9-]/g, '_')}.term`)
  }

  removeScrollback(paneId: string): void {
    try {
      rmSync(this.scrollbackFile(paneId), { force: true })
    } catch {
      /* ignore */
    }
  }

  saveScrollback(tabId: string, data: string): void {
    try {
      writeFileSync(this.scrollbackFile(tabId), data, 'utf8')
    } catch (err) {
      console.error('No se pudo guardar scrollback:', err)
    }
  }

  loadScrollback(tabId: string): string {
    try {
      const f = this.scrollbackFile(tabId)
      if (existsSync(f)) return readFileSync(f, 'utf8')
    } catch {
      /* ignore */
    }
    return ''
  }

  get snippets(): Snippet[] {
    return this.state.snippets
  }

  saveSnippet(snippet: Snippet): void {
    const i = this.state.snippets.findIndex((s) => s.id === snippet.id)
    if (i >= 0) this.state.snippets[i] = snippet
    else this.state.snippets.push(snippet)
    this.scheduleSave()
  }

  deleteSnippet(id: string): void {
    this.state.snippets = this.state.snippets.filter((s) => s.id !== id)
    this.scheduleSave()
  }

  private prefsKey(cwd: string): string {
    return cwd.replace(/[\\/]+$/, '').toLowerCase()
  }

  get updateDir(): string | undefined {
    return this.state.updateDir
  }

  setUpdateDir(dir: string | undefined): void {
    this.state.updateDir = dir
    this.scheduleSave()
  }

  /** Widgets de una pestaña; sin entrada = plantilla (layout global viejo o default) */
  getTabWidgets(tabId: string): WidgetState[] {
    const own = this.state.tabWidgets[tabId]
    if (own) return own
    const template = this.state.widgets?.length ? this.state.widgets : DEFAULT_WIDGETS
    // clon con ids frescos para que las pestañas no compartan instancias
    return template.map((w, i) => ({ ...w, id: `${w.kind}-${tabId.slice(0, 8)}-${i}`, config: { ...w.config } }))
  }

  setTabWidgets(tabId: string, widgets: WidgetState[]): void {
    this.state.tabWidgets[tabId] = widgets
    this.scheduleSave()
  }

  getProjectPrefs(cwd: string): ProjectPrefs {
    return this.state.projectPrefs[this.prefsKey(cwd)] ?? {}
  }

  setProjectPrefs(cwd: string, prefs: ProjectPrefs): void {
    const key = this.prefsKey(cwd)
    this.state.projectPrefs[key] = { ...this.state.projectPrefs[key], ...prefs }
    this.scheduleSave()
  }
}
