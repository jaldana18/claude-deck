import { spawn as spawnHijo } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TunelFase } from '../../shared/types'

/**
 * Gestor del túnel de Cloudflare que publica el servidor local del acceso
 * remoto. Todo lo que toca el sistema (proceso hijo, reloj, temporizadores)
 * entra por `TunnelDeps` para que las pruebas no necesiten cloudflared ni
 * esperas reales.
 */

/** Lo mínimo que el gestor necesita de un proceso hijo. */
export interface ProcesoTunel {
  stdout: { on(ev: 'data', cb: (c: Buffer | string) => void): void }
  stderr: { on(ev: 'data', cb: (c: Buffer | string) => void): void }
  on(ev: 'exit', cb: (code: number | null) => void): void
  kill(): void
}

export interface EstadoTunel {
  fase: TunelFase
  url: string | null
  detalle?: string
}

export interface OpcionesArranque {
  modo: 'quick' | 'dominio'
  puerto: number
  token?: string
  hostname?: string
}

export interface TunnelDeps {
  /** Lanza el proceso. Inyectado para poder probar sin cloudflared. */
  spawn?: (cmd: string, args: string[]) => ProcesoTunel
  /** Avisa de cada cambio de estado (fase, url, detalle). */
  onCambio: (estado: EstadoTunel) => void
  /** Reloj y temporizadores inyectables para que las pruebas no esperen de verdad. */
  ahora?: () => number
  programar?: (fn: () => void, ms: number) => { cancelar: () => void }
}

/**
 * Cuánto se espera a que cloudflared publique la URL. En modo `quick` vencer
 * este plazo es un fallo; en modo `dominio` no hay URL que esperar (el
 * hostname lo enruta el panel de Cloudflare), así que aguantar en pie hasta
 * aquí es la única señal disponible de que el túnel sirve.
 */
const ARRANQUE_MS = 30_000
const ESPERA_BASE_MS = 5_000
const ESPERA_TOPE_MS = 60_000
/** La URL efímera del modo quick, tal como la imprime cloudflared. */
const RE_QUICK = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
const RE_REGISTRADO = /registered tunnel connection|connection [0-9a-f-]+ registered/i
/**
 * cloudflared se queja del tamaño del buffer de recepción en casi cada
 * arranque en Windows: es ruido, no un fallo, y no debe acabar en el detalle
 * que lee el usuario.
 */
const RE_RUIDO = /increase receive buffer size/i
/** Un detalle se pinta en la UI; no es sitio para una línea de log entera. */
const DETALLE_MAX = 200

const RUTAS_CLOUDFLARED = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe'
]

/** Primera ruta que exista; si ninguna, el literal, confiando en el PATH. */
export function rutaCloudflared(existe: (p: string) => boolean = existsSync): string {
  const local = process.env.LOCALAPPDATA
  const candidatas = [...RUTAS_CLOUDFLARED]
  if (local) candidatas.push(join(local, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'))
  for (const ruta of candidatas) {
    if (existe(ruta)) return ruta
  }
  return 'cloudflared'
}

function texto(c: Buffer | string): string {
  return typeof c === 'string' ? c : c.toString('utf8')
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const FLUJO_VACIO = {
  on: (): void => {}
}

function lanzarConHijo(cmd: string, args: string[]): ProcesoTunel {
  const hijo = spawnHijo(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  return {
    stdout: hijo.stdout ?? FLUJO_VACIO,
    stderr: hijo.stderr ?? FLUJO_VACIO,
    on: (_ev, cb) => {
      hijo.on('exit', (code) => cb(code))
    },
    kill: () => {
      hijo.kill()
    }
  }
}

function programarConTimeout(fn: () => void, ms: number): { cancelar: () => void } {
  const t = setTimeout(fn, ms)
  return { cancelar: () => clearTimeout(t) }
}

export class Tunnel {
  private readonly onCambio: (estado: EstadoTunel) => void
  private readonly spawn: (cmd: string, args: string[]) => ProcesoTunel
  private readonly ahora: () => number
  private readonly programar: (fn: () => void, ms: number) => { cancelar: () => void }

  private est: EstadoTunel = { fase: 'apagado', url: null }
  private proceso: ProcesoTunel | null = null
  private opciones: OpcionesArranque | null = null
  private urlDominio: string | null = null
  private vigilancia: { cancelar: () => void } | null = null
  private reintento: { cancelar: () => void } | null = null
  private intentos = 0
  private inicio = 0
  private detenido = true
  private ultimaPista = ''
  /**
   * Un proceso que ya no manda se identifica por su época: sus datos y su
   * `exit` pueden llegar después de haberlo matado y no deben mover el estado.
   */
  private epoca = 0
  private restos: Record<'out' | 'err', string> = { out: '', err: '' }

  constructor(deps: TunnelDeps) {
    this.onCambio = deps.onCambio
    this.spawn = deps.spawn ?? lanzarConHijo
    this.ahora = deps.ahora ?? Date.now
    this.programar = deps.programar ?? programarConTimeout
  }

  get estado(): EstadoTunel {
    return { ...this.est }
  }

  arrancar(opciones: OpcionesArranque): void {
    if (this.proceso) return
    if (opciones.modo === 'dominio' && !opciones.token) {
      // Sin token no hay nada que lanzar y reintentar no lo arregla: es config.
      this.detener()
      this.emitir(
        'caido',
        null,
        'Falta el token del túnel: créalo en el panel de Cloudflare y pégalo en los ajustes del acceso remoto.'
      )
      return
    }
    if (opciones.modo === 'dominio' && !opciones.hostname) {
      this.detener()
      this.emitir('caido', null, 'Falta el hostname público del túnel en los ajustes del acceso remoto.')
      return
    }
    this.reintento?.cancelar()
    this.reintento = null
    this.detenido = false
    this.opciones = opciones
    this.intentos = 0
    this.lanzar()
  }

  detener(): void {
    this.detenido = true
    this.reintento?.cancelar()
    this.reintento = null
    this.vigilancia?.cancelar()
    this.vigilancia = null
    this.matar()
    this.intentos = 0
    this.opciones = null
    this.urlDominio = null
    this.emitir('apagado', null)
  }

  private lanzar(): void {
    const op = this.opciones
    if (!op) return
    const epoca = ++this.epoca
    this.restos = { out: '', err: '' }
    this.ultimaPista = ''
    this.urlDominio = op.hostname ? `https://${op.hostname}` : null
    this.inicio = this.ahora()
    const args =
      op.modo === 'quick'
        ? ['tunnel', '--url', `http://127.0.0.1:${op.puerto}`, '--no-autoupdate']
        : ['tunnel', 'run', '--token', op.token ?? '', '--no-autoupdate']
    this.emitir('arrancando', null)
    let proceso: ProcesoTunel
    try {
      proceso = this.spawn(rutaCloudflared(), args)
    } catch (e) {
      this.caer(`No se pudo lanzar cloudflared: ${mensaje(e)}`)
      return
    }
    this.proceso = proceso
    // cloudflared escribe la URL del túnel quick por stderr, y según versión
    // también por stdout: hay que mirar los dos flujos.
    proceso.stdout.on('data', (c) => this.alimentar(epoca, 'out', c))
    proceso.stderr.on('data', (c) => this.alimentar(epoca, 'err', c))
    proceso.on('exit', (code) => this.salio(epoca, code))
    this.vigilancia = this.programar(() => this.venceArranque(epoca), ARRANQUE_MS)
  }

  private alimentar(epoca: number, flujo: 'out' | 'err', crudo: Buffer | string): void {
    if (epoca !== this.epoca) return
    const acumulado = this.restos[flujo] + texto(crudo)
    const lineas = acumulado.split(/\r?\n/)
    const parcial = lineas.pop() ?? ''
    for (const linea of lineas) this.procesar(linea)
    // La URL puede venir en un trozo todavía sin salto de línea: se mira igual.
    this.procesar(parcial)
    this.restos[flujo] = parcial.length > 4000 ? parcial.slice(-1000) : parcial
  }

  private procesar(cruda: string): void {
    const linea = cruda.trim()
    if (!linea || RE_RUIDO.test(linea)) return
    if (this.opciones?.modo === 'quick') {
      const quick = RE_QUICK.exec(linea)
      if (quick) {
        this.subir(quick[0])
        return
      }
    }
    if (this.opciones?.modo === 'dominio' && this.urlDominio && RE_REGISTRADO.test(linea)) {
      this.subir(this.urlDominio)
      return
    }
    this.ultimaPista = linea.slice(0, DETALLE_MAX)
  }

  private subir(url: string): void {
    this.vigilancia?.cancelar()
    this.vigilancia = null
    // Un arranque bueno borra la deuda: el siguiente fallo vuelve a esperar poco.
    this.intentos = 0
    this.emitir('activo', url)
  }

  private venceArranque(epoca: number): void {
    if (epoca !== this.epoca) return
    this.vigilancia = null
    if (this.est.fase === 'activo') return
    if (this.opciones?.modo === 'dominio' && this.urlDominio) {
      this.subir(this.urlDominio)
      return
    }
    this.matar()
    const pista = this.ultimaPista ? ` Última línea: ${this.ultimaPista}` : ''
    this.caer(`cloudflared no publicó ninguna URL en ${ARRANQUE_MS / 1000} s.${pista}`)
  }

  private salio(epoca: number, code: number | null): void {
    if (epoca !== this.epoca) return
    this.proceso = null
    this.vigilancia?.cancelar()
    this.vigilancia = null
    if (this.detenido) return
    const vividos = Math.max(0, Math.round((this.ahora() - this.inicio) / 1000))
    const pista = this.ultimaPista ? ` ${this.ultimaPista}` : ''
    this.caer(`cloudflared terminó (código ${code ?? 'sin código'}) tras ${vividos} s.${pista}`)
  }

  private caer(detalle: string): void {
    this.emitir('caido', null, detalle)
    if (this.detenido) return
    const espera = Math.min(ESPERA_BASE_MS * 2 ** this.intentos, ESPERA_TOPE_MS)
    this.intentos += 1
    this.reintento = this.programar(() => {
      this.reintento = null
      if (this.detenido) return
      this.lanzar()
    }, espera)
  }

  private matar(): void {
    const p = this.proceso
    this.proceso = null
    if (!p) return
    this.epoca += 1
    try {
      p.kill()
    } catch {
      // Que ya estuviera muerto no es un problema: el objetivo era que no siga.
    }
  }

  private emitir(fase: TunelFase, url: string | null, detalle?: string): void {
    const nuevo: EstadoTunel = detalle === undefined ? { fase, url } : { fase, url, detalle }
    if (
      this.est.fase === nuevo.fase &&
      this.est.url === nuevo.url &&
      this.est.detalle === nuevo.detalle
    ) {
      return
    }
    this.est = nuevo
    this.onCambio({ ...nuevo })
  }
}
