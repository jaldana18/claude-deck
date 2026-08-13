import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { TabStatus } from '../shared/types'
import type { SessionTracker } from './sessionTracker'
import { DECK_HOOK_MARKER, DECK_PORT } from '../shared/constants'
import { backup, readJsonOr, writeJson } from './jsonEdit'

/**
 * Servidor HTTP local al que reportan los hooks Stop / Notification /
 * UserPromptSubmit instalados en los proyectos gestionados. Convierte cada
 * evento en el estado de la pestaña correspondiente (badge + toast).
 */
export class HookServer {
  private server: Server | null = null

  constructor(
    private tracker: SessionTracker,
    private getWindow: () => BrowserWindow | null
  ) {}

  start(): void {
    this.server = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
        try {
          this.handleEvent(JSON.parse(body))
        } catch {
          /* payload no-JSON: ignorar */
        }
      })
    })
    this.server.on('error', (err) => {
      // Puerto ocupado (p.ej. instancia previa cerrando): reintentar una vez.
      console.error('HookServer:', err)
      setTimeout(() => this.server?.listen(DECK_PORT, '127.0.0.1'), 3000)
    })
    this.server.listen(DECK_PORT, '127.0.0.1')
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private handleEvent(payload: Record<string, any>): void {
    const sessionId: string | undefined = payload.session_id
    const cwd: string = payload.cwd ?? ''
    const event: string = payload.hook_event_name ?? ''
    if (!sessionId || !event) return

    const tabId = this.tracker.claimFromHook(sessionId, cwd)
    if (!tabId) return

    let status: TabStatus | null = null
    let detail: string | undefined
    if (event === 'Stop') {
      status = 'done'
      detail = 'Claude terminó y espera tu siguiente instrucción'
    } else if (event === 'Notification') {
      status = 'attention'
      detail = payload.message ?? 'Claude necesita tu atención (permiso o entrada)'
    } else if (event === 'UserPromptSubmit') {
      status = 'working'
    }
    if (!status) return
    this.getWindow()?.webContents.send('tab:status', { tabId, status, detail })
  }
}

/**
 * Comando (PowerShell) que los hooks instalados ejecutan: reenvía el JSON que
 * Claude Code entrega por stdin al servidor local. Nunca falla (try/catch +
 * exit 0) para no molestar cuando claude-deck está cerrado.
 */
export function deckHookCommand(): string {
  const ps =
    `try{$b=[Console]::In.ReadToEnd();` +
    `Invoke-RestMethod -Uri 'http://127.0.0.1:${DECK_PORT}/event' -Method Post ` +
    `-ContentType 'application/json' -Body $b -TimeoutSec 3|Out-Null}catch{};exit 0`
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}" #${DECK_HOOK_MARKER}`
}

const DECK_EVENTS = ['Stop', 'Notification', 'UserPromptSubmit']

/** Instala (o quita) los hooks de notificación en .claude/settings.local.json del proyecto */
export function installDeckHooks(cwd: string, install: boolean): void {
  const file = join(cwd, '.claude', 'settings.local.json')
  backup(file)
  const settings = readJsonOr(file, {})
  settings.hooks = settings.hooks ?? {}
  for (const event of DECK_EVENTS) {
    const entries: any[] = settings.hooks[event] ?? []
    const cleaned = entries
      .map((e) => ({
        ...e,
        hooks: (e.hooks ?? []).filter((h: any) => !String(h.command ?? '').includes(DECK_HOOK_MARKER))
      }))
      .filter((e) => e.hooks.length > 0)
    if (install) {
      cleaned.push({ hooks: [{ type: 'command', command: deckHookCommand() }] })
    }
    if (cleaned.length) settings.hooks[event] = cleaned
    else delete settings.hooks[event]
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks
  writeJson(file, settings)
}
