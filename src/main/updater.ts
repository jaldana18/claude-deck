import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { DEFAULT_UPDATE_DIR } from '../shared/constants'
import type { Store } from './store'

export interface UpdateInfo {
  version: string
  installerPath: string
}

/**
 * Auto-actualización local: la app instalada revisa la carpeta release/ del
 * proyecto (donde `npm run dist` deja los Setup) y, si hay una versión mayor
 * que la instalada, la ofrece. Instalar = correr el NSIS en silencio (/S) y
 * relanzar. Sin servidores: pensado para una app que se compila en el mismo PC.
 */
export class Updater {
  private notified = ''

  constructor(
    private getWindow: () => BrowserWindow | null,
    private store: Store
  ) {}

  /** Carpeta vigilada: la configurada por el usuario (p.ej. compartida del
   *  equipo en OneDrive/red) o la release/ local del desarrollador */
  private get updateDir(): string {
    return this.store.updateDir || DEFAULT_UPDATE_DIR
  }

  /** Cambia la carpeta de actualizaciones y chequea de inmediato */
  setDir(dir: string): void {
    this.store.setUpdateDir(dir)
    this.notified = ''
    this.checkAndNotify()
  }

  getDir(): string {
    return this.updateDir
  }

  private lastFocusCheck = 0

  startAutoCheck(): void {
    // Al arrancar (con margen para no competir con el arranque) y cada 4 horas
    setTimeout(() => this.checkAndNotify(), 15_000)
    setInterval(() => this.checkAndNotify(), 4 * 60 * 60 * 1000)
  }

  /** Llamar cuando la ventana recupera el foco: chequeo extra con freno corto */
  onWindowFocus(): void {
    const now = Date.now()
    if (now - this.lastFocusCheck < 15_000) return
    this.lastFocusCheck = now
    this.checkAndNotify()
  }

  check(): UpdateInfo | null {
    try {
      if (!existsSync(this.updateDir)) return null
      const current = parseVersion(app.getVersion())
      let best: { v: number[]; file: string } | null = null
      for (const f of readdirSync(this.updateDir)) {
        const m = f.match(/^ClaudeDeck-Setup-(\d+\.\d+\.\d+)\.exe$/)
        if (!m) continue
        const v = parseVersion(m[1])
        if (compare(v, current) > 0 && (!best || compare(v, best.v) > 0)) {
          best = { v, file: f }
        }
      }
      if (!best) return null
      return { version: best.v.join('.'), installerPath: join(this.updateDir, best.file) }
    } catch {
      return null
    }
  }

  private checkAndNotify(): void {
    const info = this.check()
    if (info && info.version !== this.notified) {
      try {
        const win = this.getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('update:available', info)
          // marcar como notificada solo si de verdad se pudo avisar
          this.notified = info.version
        }
      } catch {
        /* ventana cerrándose */
      }
    }
  }

  /** Lanza el instalador en silencio y cierra la app; el instalador la relanza */
  install(info: UpdateInfo): void {
    if (!existsSync(info.installerPath)) return
    const child = spawn(info.installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    // pequeño margen para que el proceso hijo arranque antes de soltar el lock
    setTimeout(() => app.quit(), 500)
  }
}

function parseVersion(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0)
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return 0
}
