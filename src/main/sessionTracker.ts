import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { Store } from './store'

/**
 * Claude Code guarda cada sesión como
 *   ~/.claude/projects/<cwd-codificado>/<session-id>.jsonl
 * El cwd se codifica reemplazando todo lo que no sea [a-zA-Z0-9-] por '-'.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-')
}

export function projectSessionsDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectDir(cwd))
}

interface Watch {
  tabId: string
  cwd: string
  /** Solo archivos modificados después de este instante pueden pertenecer a la pestaña */
  sinceMs: number
}

/**
 * Detecta a qué sesión de Claude pertenece cada pestaña observando por polling
 * los .jsonl del proyecto: el archivo nuevo (o recién modificado) más reciente
 * no reclamado por otra pestaña se asigna a la pestaña. Cuando el usuario hace
 * /clear o /resume el id cambia y el tracker lo re-detecta solo.
 */
export class SessionTracker {
  private watches = new Map<string, Watch>()
  /** sessionId -> tabId */
  private claims = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private store: Store,
    private getWindow: () => BrowserWindow | null
  ) {}

  startTracking(tabId: string, cwd: string): void {
    this.watches.set(tabId, { tabId, cwd, sinceMs: Date.now() - 2000 })
    const current = this.store.tabs.find((t) => t.id === tabId)?.claudeSessionId
    if (current) this.claims.set(current, tabId)
    this.ensureTimer()
  }

  stopTracking(tabId: string): void {
    this.watches.delete(tabId)
    for (const [sid, tid] of this.claims) if (tid === tabId) this.claims.delete(sid)
    if (this.watches.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  sessionForTab(tabId: string): string | undefined {
    return this.store.tabs.find((t) => t.id === tabId)?.claudeSessionId
  }

  tabForSession(sessionId: string): string | undefined {
    const claimed = this.claims.get(sessionId)
    if (claimed) return claimed
    return this.store.tabs.find((t) => t.claudeSessionId === sessionId)?.id
  }

  /**
   * Los hooks reportan session_id + cwd: si aún no conocemos esa sesión,
   * la asignamos a la pestaña activa de ese cwd. Es la señal más fiable.
   */
  claimFromHook(sessionId: string, cwd: string): string | undefined {
    const known = this.tabForSession(sessionId)
    if (known) return known
    const candidate = [...this.watches.values()].find(
      (w) => normalize(w.cwd) === normalize(cwd) && !this.hasClaim(w.tabId)
    ) ?? [...this.watches.values()].find((w) => normalize(w.cwd) === normalize(cwd))
    if (candidate) this.assign(candidate.tabId, sessionId)
    return candidate?.tabId
  }

  private hasClaim(tabId: string): boolean {
    for (const tid of this.claims.values()) if (tid === tabId) return true
    return false
  }

  private assign(tabId: string, sessionId: string): void {
    const prev = this.sessionForTab(tabId)
    if (prev === sessionId) return
    if (prev) this.claims.delete(prev)
    this.claims.set(sessionId, tabId)
    this.store.updateTab(tabId, { claudeSessionId: sessionId })
    this.getWindow()?.webContents.send('tab:session', { tabId, sessionId })
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.poll(), 3000)
  }

  private poll(): void {
    for (const watch of this.watches.values()) {
      try {
        const dir = projectSessionsDir(watch.cwd)
        const files = readdirSync(dir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => {
            const full = join(dir, f)
            return { id: basename(f, '.jsonl'), mtimeMs: statSync(full).mtimeMs }
          })
          .filter((f) => f.mtimeMs > watch.sinceMs)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)

        const current = this.sessionForTab(watch.tabId)
        // El más reciente no reclamado por OTRA pestaña gana; así seguimos
        // el cambio de id tras /clear o /resume manual.
        const winner = files.find((f) => {
          const owner = this.claims.get(f.id)
          return !owner || owner === watch.tabId
        })
        if (winner && winner.id !== current) this.assign(watch.tabId, winner.id)
      } catch {
        // El directorio aún no existe (primera sesión en ese cwd): normal.
      }
    }
  }
}

function normalize(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase()
}
