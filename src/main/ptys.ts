import { spawn, type IPty } from '@lydell/node-pty'
import type { BrowserWindow } from 'electron'
import type { TabState } from '../shared/types'

const BUFFER_CAP = 300_000

/**
 * Un PTY (ConPTY en Windows) por PANEL. El panel principal de una pestaña usa
 * el propio tabId como paneId; los paneles extra de un split usan `tabId#n`.
 * Se lanza PowerShell con -NoExit (con `claude` dentro para el panel principal
 * de las pestañas de terminal clásico), y la salida se bufferiza hasta que el
 * terminal del renderer hace attach.
 */
export class PtyManager {
  private ptys = new Map<string, IPty>()
  private buffers = new Map<string, string>()
  private attached = new Set<string>()

  constructor(private getWindow: () => BrowserWindow | null) {}

  /** Comando interno del panel principal según el modo de la pestaña */
  buildCommand(tab: TabState): string | null {
    if (tab.mode === 'chat' || tab.profile !== 'claude') return null
    return tab.claudeSessionId ? `claude --resume ${tab.claudeSessionId}` : 'claude'
  }

  startPane(
    paneId: string,
    cwd: string,
    command: string | null,
    shell: 'powershell' | 'cmd' | 'bash' = 'powershell',
    cols = 120,
    rows = 30
  ): void {
    this.kill(paneId)
    this.buffers.set(paneId, '')
    // Selector de shell (kit §7). El panel con la TUI de claude siempre corre
    // en PowerShell (command != null); los paneles planos usan el elegido.
    const exe =
      command || shell === 'powershell'
        ? 'powershell.exe'
        : shell === 'cmd'
          ? 'cmd.exe'
          : 'bash.exe'
    const args =
      exe === 'powershell.exe'
        ? ['-NoLogo', '-NoExit', ...(command ? ['-Command', command] : [])]
        : exe === 'cmd.exe'
          ? []
          : ['-i']
    let pty: IPty
    try {
      pty = spawn(exe, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>
      })
    } catch (err) {
      // shell no disponible (p.ej. bash.exe sin Git for Windows): avisar en el
      // propio terminal y caer a PowerShell para no dejar el panel muerto
      this.emit(paneId, `\r\n\x1b[31mNo se pudo iniciar ${exe}: ${err}\x1b[0m\r\n`)
      if (exe !== 'powershell.exe') {
        this.startPane(paneId, cwd, command, 'powershell', cols, rows)
      }
      return
    }
    this.ptys.set(paneId, pty)

    pty.onData((data) => this.emit(paneId, data))
    pty.onExit(({ exitCode }) => {
      // Si este pty ya fue reemplazado (cambio de shell / relanzamiento), su
      // salida tardía NO debe marcar el panel como terminado.
      if (this.ptys.get(paneId) !== pty) return
      this.ptys.delete(paneId)
      this.send('pty:exit', { paneId, exitCode })
    })
  }

  private emit(paneId: string, data: string): void {
    if (this.attached.has(paneId)) {
      this.send('pty:data', { paneId, data })
    } else {
      const buf = (this.buffers.get(paneId) ?? '') + data
      this.buffers.set(paneId, buf.length > BUFFER_CAP ? buf.slice(-BUFFER_CAP) : buf)
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

  /** El renderer ya montó el terminal: entregar lo bufferizado y pasar a streaming */
  attach(paneId: string): string {
    const pending = this.buffers.get(paneId) ?? ''
    this.buffers.set(paneId, '')
    this.attached.add(paneId)
    return pending
  }

  detachAll(): void {
    this.attached.clear()
  }

  write(paneId: string, data: string): void {
    this.ptys.get(paneId)?.write(data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    try {
      this.ptys.get(paneId)?.resize(Math.max(cols, 2), Math.max(rows, 2))
    } catch {
      /* el pty pudo haber muerto entre medias */
    }
  }

  isRunning(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  kill(paneId: string): void {
    const pty = this.ptys.get(paneId)
    this.attached.delete(paneId)
    this.buffers.delete(paneId)
    if (!pty) return
    this.ptys.delete(paneId)
    try {
      pty.kill()
    } catch {
      /* ignore */
    }
  }

  /** Mata todos los paneles de una pestaña (tabId y tabId#n) */
  killTabPanes(tabId: string): void {
    for (const id of [...this.ptys.keys()]) {
      if (id === tabId || id.startsWith(`${tabId}#`)) this.kill(id)
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }
}
