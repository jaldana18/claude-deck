import { networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import type {
  PairingInfo,
  RemoteDevice,
  RemoteSettings,
  RemoteStatus,
  TabState
} from '../../shared/types'
import type { Emitter } from '../bus'
import type { Bus } from '../bus'
import type { Ownership } from '../ownership'
import { Auth } from './auth'
import { Dispatcher } from './dispatch'
import { Gateway } from './gateway'
import { Tunnel, type EstadoTunel } from './tunnel'

/**
 * Coordina el acceso remoto: ajustes, autenticación, servidor y túnel.
 *
 * Todo arranca apagado y se enciende a mano. Encender publica el PC en
 * internet, y eso no puede pasar por omisión ni quedarse encendido porque nadie
 * se acordó de apagarlo: de ahí el apagado automático opcional.
 */

/** Lo que el gestor necesita del Store, para poder probarlo sin electron. */
export interface RemoteStore {
  readonly remote: RemoteSettings
  setRemote(patch: Partial<RemoteSettings>): RemoteSettings
  readonly remoteDevices: RemoteDevice[]
  setRemoteDevices(ds: RemoteDevice[]): void
  readonly remoteHashes: Record<string, string>
  setRemoteHashes(h: Record<string, string>): void
  readonly tabs: TabState[]
}

export interface ManagerDeps {
  store: RemoteStore
  bus: Bus
  ownership: Ownership
  /** Invoca un canal del main ya autorizado. */
  invocar: (canal: string, args: unknown) => Promise<unknown> | unknown
  /** Carpeta con el cliente web compilado. */
  webDir: string
  /** Inyectables para las pruebas. */
  crearTunel?: (onCambio: (e: EstadoTunel) => void) => Tunnel
  ahora?: () => number
}

const REVISION_MS = 60_000

export class RemoteManager {
  private auth: Auth
  private gateway: Gateway
  private tunnel: Tunnel
  private tunelEstado: EstadoTunel = { fase: 'apagado', url: null }
  private encendido = false
  private alerta: string | undefined
  private ultimaActividad: number
  private revision: NodeJS.Timeout | null = null
  private ahora: () => number
  /** Puerto que acabó escuchando: con 0 lo elige el sistema. */
  private puertoReal = 0

  constructor(private deps: ManagerDeps) {
    this.ahora = deps.ahora ?? Date.now
    this.ultimaActividad = this.ahora()
    this.auth = new Auth(
      {
        leer: () => deps.store.remoteDevices,
        escribir: (ds) => deps.store.setRemoteDevices(ds),
        leerHashes: () => deps.store.remoteHashes,
        escribirHashes: (h) => deps.store.setRemoteHashes(h)
      },
      this.ahora
    )
    this.gateway = new Gateway({
      bus: deps.bus,
      auth: this.auth,
      ownership: deps.ownership,
      webDir: deps.webDir,
      dispatcher: new Dispatcher({
        invocar: (canal, args) => {
          this.ultimaActividad = this.ahora()
          return deps.invocar(canal, args)
        },
        puedeActuar: (tabId, clientId) => deps.ownership.puedeActuar(tabId, clientId),
        raices: () => this.raices()
      })
    })
    const onCambio = (e: EstadoTunel): void => this.tunelCambio(e)
    this.tunnel = deps.crearTunel
      ? deps.crearTunel(onCambio)
      : new Tunnel({ onCambio, ahora: this.ahora })
  }

  // ---------- estado ----------

  get ajustes(): RemoteSettings {
    return this.deps.store.remote
  }

  estado(): RemoteStatus {
    const cerrada = this.auth.cerrada
    const codigo = this.auth.codigoVigente
    const url = this.urlPublica()
    return {
      enabled: this.encendido,
      url,
      tunel: this.tunelEstado.fase,
      ...(this.tunelEstado.detalle ? { detalle: this.tunelEstado.detalle } : {}),
      dispositivos: this.auth.dispositivos(),
      conectados: this.gateway.conectados,
      ...(cerrada ? { bloqueadoHasta: cerrada } : {}),
      ...(codigo && url
        ? { pairing: { url: `${url}/#c=${codigo.codigo}`, codigo: codigo.codigo, expira: codigo.expira } }
        : {}),
      ...(this.alerta ? { alerta: this.alerta } : {})
    }
  }

  private anunciar(): void {
    ;(this.deps.bus as Emitter).send('remote:status', this.estado())
  }

  /**
   * Dirección por la que entra el móvil. Con túnel la da cloudflared; sin él
   * es la IP de la red local, que solo sirve estando en la misma wifi.
   */
  private urlPublica(): string | null {
    const s = this.ajustes
    if (s.tunel === 'ninguno') {
      const ip = this.ipLocal()
      return ip ? `http://${ip}:${this.puertoReal || s.puerto}` : null
    }
    if (s.tunel === 'dominio') return s.hostname ? `https://${s.hostname}` : null
    return this.tunelEstado.url
  }

  private ipLocal(): string | null {
    for (const lista of Object.values(networkInterfaces())) {
      for (const n of lista ?? []) {
        if (n.family === 'IPv4' && !n.internal) return n.address
      }
    }
    return null
  }

  /**
   * Carpetas que el acceso remoto puede mirar. Por defecto, las de las pestañas
   * abiertas y su carpeta madre: así se puede abrir un chat en un proyecto
   * hermano sin darle acceso al disco entero.
   */
  raices(): string[] {
    const s = this.ajustes
    if (s.raices?.length) return s.raices
    const out = new Set<string>()
    for (const t of this.deps.store.tabs) {
      if (!t.cwd) continue
      out.add(t.cwd)
      const madre = dirname(t.cwd)
      if (madre && madre !== t.cwd) out.add(madre)
    }
    return [...out]
  }

  // ---------- encendido ----------

  async encender(): Promise<RemoteStatus> {
    if (this.encendido) return this.estado()
    const s = this.ajustes
    this.puertoReal = await this.gateway.arrancar(s.puerto, s.tunel === 'ninguno')
    this.encendido = true
    this.alerta = undefined
    this.ultimaActividad = this.ahora()
    if (s.tunel !== 'ninguno') {
      this.tunnel.arrancar({
        modo: s.tunel,
        puerto: s.puerto,
        ...(s.tunelToken ? { token: s.tunelToken } : {}),
        ...(s.hostname ? { hostname: s.hostname } : {})
      })
    }
    this.vigilarInactividad()
    this.deps.store.setRemote({ enabled: true })
    this.anunciar()
    return this.estado()
  }

  async apagar(): Promise<RemoteStatus> {
    this.tunnel.detener()
    this.tunelEstado = { fase: 'apagado', url: null }
    await this.gateway.detener()
    this.encendido = false
    this.auth.cancelarCodigo()
    if (this.revision) clearInterval(this.revision)
    this.revision = null
    this.deps.store.setRemote({ enabled: false })
    this.anunciar()
    return this.estado()
  }

  /** Cambia ajustes; si estaba encendido y el cambio afecta al servidor, reinicia. */
  async aplicar(patch: Partial<RemoteSettings>): Promise<RemoteStatus> {
    const antes = this.ajustes
    const despues = this.deps.store.setRemote(patch)
    const reinicia =
      antes.puerto !== despues.puerto ||
      antes.tunel !== despues.tunel ||
      antes.hostname !== despues.hostname ||
      antes.tunelToken !== despues.tunelToken
    if (patch.enabled === false) return this.apagar()
    if (patch.enabled === true && !this.encendido) return this.encender()
    if (this.encendido && reinicia) {
      await this.apagar()
      return this.encender()
    }
    this.anunciar()
    return this.estado()
  }

  /** Al arrancar la app: solo se publica si quedó encendido a propósito. */
  async restaurar(): Promise<void> {
    if (!this.ajustes.enabled) return
    try {
      await this.encender()
    } catch (err) {
      this.alerta = `No se pudo publicar el acceso remoto: ${String((err as Error).message ?? err)}`
      this.encendido = false
      this.anunciar()
    }
  }

  // ---------- emparejamiento ----------

  emparejar(): { pairing?: PairingInfo; error?: string } {
    if (!this.encendido) return { error: 'Enciende el acceso remoto antes de emparejar' }
    const url = this.urlPublica()
    if (!url) {
      return {
        error:
          this.ajustes.tunel === 'dominio'
            ? 'Falta el nombre público del túnel'
            : 'Esperando la dirección del túnel'
      }
    }
    const { codigo, expira } = this.auth.nuevoCodigo()
    this.alerta = undefined
    this.anunciar()
    return { pairing: { url: `${url}/#c=${codigo}`, codigo, expira } }
  }

  revocar(clientId: string): RemoteStatus {
    this.auth.revocar(clientId)
    this.deps.ownership.unregister(clientId)
    this.anunciar()
    return this.estado()
  }

  revocarTodos(): RemoteStatus {
    for (const d of this.auth.dispositivos()) this.deps.ownership.unregister(d.clientId)
    this.auth.revocarTodos()
    this.anunciar()
    return this.estado()
  }

  // ---------- reacciones ----------

  private tunelCambio(e: EstadoTunel): void {
    const urlAnterior = this.tunelEstado.url
    this.tunelEstado = e
    if (e.fase === 'caido') {
      this.alerta = e.detalle ?? 'El túnel se cayó. Reintentando…'
    } else if (e.fase === 'activo' && e.url && urlAnterior && e.url !== urlAnterior) {
      // Con túnel quick la dirección es otra, y para el móvil eso es otro sitio:
      // la app instalada y su emparejamiento apuntaban a la anterior.
      this.alerta = 'El túnel cambió de dirección. Vuelve a escanear el QR en el móvil.'
      if (this.auth.dispositivos().length > 0) this.auth.nuevoCodigo()
    } else if (e.fase === 'activo') {
      this.alerta = undefined
    }
    this.anunciar()
  }

  private vigilarInactividad(): void {
    if (this.revision) clearInterval(this.revision)
    this.revision = setInterval(() => {
      const minutos = this.ajustes.apagarTrasMin
      if (!minutos || !this.encendido) return
      if (this.gateway.conectados.length > 0) {
        this.ultimaActividad = this.ahora()
        return
      }
      if (this.ahora() - this.ultimaActividad < minutos * 60_000) return
      this.alerta = `Acceso remoto apagado solo tras ${minutos} min sin uso.`
      void this.apagar()
    }, REVISION_MS)
    // El temporizador no debe impedir que la app se cierre.
    this.revision.unref?.()
  }
}
