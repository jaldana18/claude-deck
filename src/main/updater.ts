import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BrowserWindow } from 'electron'
import { UPDATE_REPO } from '../shared/constants'
import { compareVersions as compare, parseVersion } from '../shared/version'
import type { Store } from './store'

export interface UpdateInfo {
  version: string
  /** instalador ya en disco (carpeta local o compartida del equipo) */
  installerPath?: string
  /** instalador remoto (GitHub Releases) — se descarga al instalar */
  url?: string
}

/**
 * Auto-actualización con dos fuentes, se ofrece la versión MAYOR de ambas:
 * 1. GitHub Releases del repo (UPDATE_REPO): consulta la API pública y, al
 *    instalar, descarga el Setup a temp y lo corre en silencio. Es la vía
 *    por defecto — no requiere configurar nada.
 * 2. Carpeta local/compartida opcional (store.updateDir): útil para equipos
 *    sin acceso a GitHub o para probar builds locales. En desarrollo el
 *    fallback es la release/ del propio proyecto.
 */
export class Updater {
  private notified = ''

  constructor(
    private getWindow: () => BrowserWindow | null,
    private store: Store
  ) {}

  private get updateDir(): string {
    if (this.store.updateDir) return this.store.updateDir
    return app.isPackaged ? '' : join(app.getAppPath(), 'release')
  }

  /** Cambia la carpeta de actualizaciones y chequea de inmediato */
  setDir(dir: string): void {
    this.store.setUpdateDir(dir)
    this.notified = ''
    void this.checkAndNotify()
  }

  getDir(): string {
    return this.updateDir
  }

  private lastFocusCheck = 0

  startAutoCheck(): void {
    // Al arrancar (con margen para no competir con el arranque) y cada 4 horas
    setTimeout(() => void this.checkAndNotify(), 15_000)
    setInterval(() => void this.checkAndNotify(), 4 * 60 * 60 * 1000)
  }

  /** Llamar cuando la ventana recupera el foco: chequeo extra con freno corto */
  onWindowFocus(): void {
    const now = Date.now()
    if (now - this.lastFocusCheck < 15_000) return
    this.lastFocusCheck = now
    void this.checkAndNotify()
  }

  async check(force = false): Promise<UpdateInfo | null> {
    const local = this.checkLocal()
    const remote = await this.checkRemote(force)
    if (local && remote) {
      return compare(parseVersion(remote.version), parseVersion(local.version)) > 0
        ? remote
        : local
    }
    return remote ?? local
  }

  private checkLocal(): UpdateInfo | null {
    try {
      if (!this.updateDir || !existsSync(this.updateDir)) return null
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

  private lastRemoteAt = 0
  private remoteCache: UpdateInfo | null = null

  /** GitHub Releases: como máximo una consulta cada 10 min (límite de la API);
   *  force = chequeo manual del usuario, salta el freno */
  private async checkRemote(force = false): Promise<UpdateInfo | null> {
    const now = Date.now()
    if (!force && now - this.lastRemoteAt < 10 * 60 * 1000) return this.remoteCache
    this.lastRemoteAt = now
    this.remoteCache = null
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 10_000)
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        signal: ctl.signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-deck-updater' }
      })
      clearTimeout(timer)
      if (!res.ok) return null
      const rel = (await res.json()) as {
        tag_name?: string
        assets?: { name: string; browser_download_url: string }[]
      }
      const version = String(rel.tag_name ?? '').replace(/^v/, '')
      if (!/^\d+\.\d+\.\d+$/.test(version)) return null
      if (compare(parseVersion(version), parseVersion(app.getVersion())) <= 0) return null
      const asset = (rel.assets ?? []).find((a) => /^ClaudeDeck-Setup-.+\.exe$/.test(a.name))
      if (!asset) return null
      this.remoteCache = { version, url: asset.browser_download_url }
      return this.remoteCache
    } catch {
      return null
    }
  }

  private async checkAndNotify(): Promise<void> {
    const info = await this.check()
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

  private sendProgress(percent: number): void {
    try {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', { percent })
    } catch {
      /* ventana cerrándose */
    }
  }

  /**
   * Instala: si el Setup es remoto primero lo descarga a temp (con progreso),
   * luego lo corre en silencio (/S) y cierra la app; el instalador la relanza.
   */
  async install(info: UpdateInfo): Promise<void> {
    let exe = info.installerPath
    if (!exe && info.url) {
      exe = join(app.getPath('temp'), `ClaudeDeck-Setup-${info.version}.exe`)
      const res = await fetch(info.url, {
        headers: { 'User-Agent': 'claude-deck-updater' },
        redirect: 'follow'
      })
      if (!res.ok || !res.body) throw new Error(`La descarga falló: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length') ?? 0)
      let done = 0
      const reader = Readable.fromWeb(res.body as never)
      reader.on('data', (chunk: Buffer) => {
        done += chunk.length
        if (total > 0) this.sendProgress(Math.round((done / total) * 100))
      })
      await pipeline(reader, createWriteStream(exe))
      this.sendProgress(100)
    }
    if (!exe || !existsSync(exe)) throw new Error('No se encontró el instalador')
    const child = spawn(exe, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    // pequeño margen para que el proceso hijo arranque antes de soltar el lock
    setTimeout(() => app.quit(), 500)
  }
}

