import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { RemoteDevice } from '../../shared/types'

/**
 * Emparejamiento y autenticación del acceso remoto.
 *
 * No hay capa delante: al descartarse Cloudflare Access, esto es lo único que
 * separa la conversación de internet. De ahí las decisiones:
 *
 * - El token es de 256 bits aleatorios y viaja en cada petición, también en la
 *   del canal de eventos. No hay sesión ni cookie que se pueda heredar.
 * - Del token solo se guarda el hash. Se enseña una vez, dentro del QR.
 * - El código de emparejamiento es corto porque hay que teclearlo o escanearlo,
 *   así que dura minutos, sirve una sola vez y se acompaña de un cierre por
 *   intentos fallidos. Sin ese cierre, ocho caracteres se rompen a fuerza bruta.
 * - El cierre es global y no por IP: detrás del túnel todas las peticiones
 *   llegan desde 127.0.0.1, así que contar por origen no protegería de nada.
 */

/** Sin vocales ni caracteres que se confundan al leerlos de una pantalla. */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

const CODIGO_LARGO = 8
const CODIGO_VIDA_MS = 5 * 60_000
const FALLOS_PARA_CERRAR = 10
const CIERRE_BASE_MS = 5 * 60_000
const CIERRE_TOPE_MS = 30 * 60_000

export interface Emparejamiento {
  codigo: string
  expira: number
}

export interface AlmacenDispositivos {
  leer(): RemoteDevice[]
  escribir(ds: RemoteDevice[]): void
  /** hash del token por clientId */
  leerHashes(): Record<string, string>
  escribirHashes(h: Record<string, string>): void
}

export interface ResultadoEmparejar {
  ok: boolean
  token?: string
  device?: RemoteDevice
  /** Motivo para el cliente: nunca dice si el código existía o no. */
  error?: string
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Comparación en tiempo constante de dos hashes hex del mismo largo. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export class Auth {
  private pendiente: Emparejamiento | null = null
  private fallos = 0
  private rondas = 0
  private cerradoHasta = 0

  constructor(
    private almacen: AlmacenDispositivos,
    private ahora: () => number = Date.now
  ) {}

  /**
   * Abre una ventana de emparejamiento. Pedir otro código invalida el anterior:
   * no puede haber dos puertas abiertas a la vez.
   */
  nuevoCodigo(): Emparejamiento {
    let codigo = ''
    const bytes = randomBytes(CODIGO_LARGO)
    for (let i = 0; i < CODIGO_LARGO; i++) codigo += ALFABETO[bytes[i] % ALFABETO.length]
    this.pendiente = { codigo, expira: this.ahora() + CODIGO_VIDA_MS }
    return this.pendiente
  }

  cancelarCodigo(): void {
    this.pendiente = null
  }

  get codigoVigente(): Emparejamiento | null {
    if (!this.pendiente) return null
    return this.pendiente.expira > this.ahora() ? this.pendiente : null
  }

  /** Instante hasta el que la autenticación está cerrada, o 0 si está abierta. */
  get cerrada(): number {
    return this.cerradoHasta > this.ahora() ? this.cerradoHasta : 0
  }

  emparejar(codigo: string, nombre: string): ResultadoEmparejar {
    if (this.cerrada) return { ok: false, error: 'Demasiados intentos. Prueba más tarde.' }
    const vigente = this.codigoVigente
    // Mismo mensaje para código inexistente, caducado o equivocado: distinguirlos
    // le diría a quien prueba a ciegas si hay una ventana abierta.
    if (!vigente || !igual(hash(vigente.codigo), hash(codigo.trim().toUpperCase()))) {
      this.anotarFallo()
      return { ok: false, error: 'Código inválido o caducado' }
    }
    // De un solo uso: si alguien más lo tenía, ya no le sirve.
    this.pendiente = null
    this.exito()

    const token = randomBytes(32).toString('base64url')
    const device: RemoteDevice = {
      clientId: randomUUID(),
      nombre: nombre.trim().slice(0, 40) || 'Dispositivo',
      creado: this.ahora()
    }
    this.almacen.escribir([...this.almacen.leer(), device])
    this.almacen.escribirHashes({ ...this.almacen.leerHashes(), [device.clientId]: hash(token) })
    return { ok: true, token, device }
  }

  /** Devuelve el dispositivo dueño del token, o null. Cuenta el fallo. */
  verificar(token: string | undefined): RemoteDevice | null {
    if (this.cerrada) return null
    if (!token) {
      this.anotarFallo()
      return null
    }
    const h = hash(token)
    const hashes = this.almacen.leerHashes()
    for (const [clientId, guardado] of Object.entries(hashes)) {
      if (!igual(guardado, h)) continue
      this.exito()
      const ds = this.almacen.leer()
      const device = ds.find((d) => d.clientId === clientId)
      if (!device) continue
      device.ultimoVisto = this.ahora()
      this.almacen.escribir(ds)
      return device
    }
    this.anotarFallo()
    return null
  }

  revocar(clientId: string): void {
    this.almacen.escribir(this.almacen.leer().filter((d) => d.clientId !== clientId))
    const hashes = { ...this.almacen.leerHashes() }
    delete hashes[clientId]
    this.almacen.escribirHashes(hashes)
  }

  revocarTodos(): void {
    this.almacen.escribir([])
    this.almacen.escribirHashes({})
    this.pendiente = null
  }

  dispositivos(): RemoteDevice[] {
    return this.almacen.leer()
  }

  private anotarFallo(): void {
    this.fallos++
    if (this.fallos < FALLOS_PARA_CERRAR) return
    this.fallos = 0
    this.rondas++
    // Cada cierre dura el doble que el anterior: un intento por fuerza bruta se
    // vuelve inviable en minutos sin castigar un dedo torpe.
    const espera = Math.min(CIERRE_TOPE_MS, CIERRE_BASE_MS * 2 ** (this.rondas - 1))
    this.cerradoHasta = this.ahora() + espera
  }

  private exito(): void {
    this.fallos = 0
    this.rondas = 0
    this.cerradoHasta = 0
  }
}
