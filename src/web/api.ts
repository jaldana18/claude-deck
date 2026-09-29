import type {
  ChatAttachment,
  ChatMessage,
  ModelOption,
  OwnerState,
  SessionListItem,
  SessionSnapshot,
  TabState
} from '../shared/types'

/**
 * Todo lo que este cliente sabe hacer contra el PC: emparejarse, pedir acciones
 * y escuchar el flujo de eventos. Nada más habla por HTTP.
 */

const CLAVE_TOKEN = 'deck.token'
const CLAVE_CLIENTE = 'deck.clientId'
const CLAVE_NOMBRE = 'deck.nombre'

export interface Sesion {
  token: string
  clientId: string
}

export function sesion(): Sesion | null {
  const token = localStorage.getItem(CLAVE_TOKEN)
  const clientId = localStorage.getItem(CLAVE_CLIENTE)
  return token && clientId ? { token, clientId } : null
}

export function olvidarSesion(): void {
  localStorage.removeItem(CLAVE_TOKEN)
  localStorage.removeItem(CLAVE_CLIENTE)
}

export function nombreDispositivo(): string {
  const guardado = localStorage.getItem(CLAVE_NOMBRE)
  if (guardado) return guardado
  const ua = navigator.userAgent
  if (/iPad/i.test(ua)) return 'iPad'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return 'Movil Android'
  return 'Navegador'
}

export type Motivo = 'no-permitido' | 'sin-control' | 'ruta-fuera' | 'fallo' | 'sin-red'

/** Un «no» del PC: el motivo distingue perder el control de un fallo real. */
export class ErrorAccion extends Error {
  constructor(
    mensaje: string,
    readonly motivo: Motivo
  ) {
    super(mensaje)
    this.name = 'ErrorAccion'
  }
}

/** El token ya no vale: hay que volver a emparejar. */
export class TokenMuerto extends Error {
  constructor(mensaje = 'La vinculación con el PC caducó') {
    super(mensaje)
    this.name = 'TokenMuerto'
  }
}

let avisarExpirado: (() => void) | null = null

/** Un 401 en cualquier petición desemboca aquí: borra el token y vuelve a emparejar. */
export function cuandoExpire(fn: () => void): void {
  avisarExpirado = fn
}

function expirar(): TokenMuerto {
  olvidarSesion()
  avisarExpirado?.()
  return new TokenMuerto()
}

export async function emparejar(codigo: string, nombre: string): Promise<Sesion> {
  let res: Response
  try {
    res = await fetch('/api/emparejar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, nombre })
    })
  } catch {
    throw new ErrorAccion('No se pudo contactar con el PC', 'sin-red')
  }
  const cuerpo = (await res.json().catch(() => ({}))) as {
    token?: string
    clientId?: string
    error?: string
  }
  if (!res.ok || !cuerpo.token || !cuerpo.clientId) {
    throw new ErrorAccion(cuerpo.error ?? 'El código no vale', 'fallo')
  }
  localStorage.setItem(CLAVE_TOKEN, cuerpo.token)
  localStorage.setItem(CLAVE_CLIENTE, cuerpo.clientId)
  localStorage.setItem(CLAVE_NOMBRE, nombre)
  return { token: cuerpo.token, clientId: cuerpo.clientId }
}

interface RespuestaAccion {
  ok: boolean
  data?: unknown
  error?: string
  motivo?: Motivo
}

export async function accion<T>(canal: string, args?: unknown): Promise<T> {
  const s = sesion()
  if (!s) throw expirar()

  let res: Response
  try {
    res = await fetch('/api/accion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ canal, args })
    })
  } catch {
    throw new ErrorAccion('Sin conexión con el PC', 'sin-red')
  }
  if (res.status === 401) throw expirar()
  if (!res.ok) throw new ErrorAccion(`El PC respondió ${res.status}`, 'fallo')

  const cuerpo = (await res.json().catch(() => ({ ok: false, error: 'Respuesta ilegible' }))) as RespuestaAccion
  if (!cuerpo.ok) throw new ErrorAccion(cuerpo.error ?? 'No se pudo hacer', cuerpo.motivo ?? 'fallo')
  return cuerpo.data as T
}

// ---------- lectura ----------

export interface ListaPestanas {
  tabs: TabState[]
  running: Array<{ id: string; running: boolean }>
}

export interface NodoFs {
  name: string
  path: string
  isDir: boolean
  children?: NodoFs[]
}

export const pedirPestanas = (): Promise<ListaPestanas> => accion<ListaPestanas>('tabs:list')

export const pedirSnapshots = (): Promise<SessionSnapshot[]> =>
  accion<SessionSnapshot[]>('chat:snapshotAll')

export const pedirSnapshot = (tabId: string): Promise<SessionSnapshot | null> =>
  accion<SessionSnapshot | null>('chat:snapshot', tabId)

export const pedirDuenos = (): Promise<OwnerState[]> => accion<OwnerState[]>('chat:owners')

export const pedirHistorial = (tabId: string): Promise<ChatMessage[]> =>
  accion<ChatMessage[]>('chat:history', tabId)

export const pedirRaices = (): Promise<string[]> => accion<string[]>('remote:raices')

export const pedirSesiones = (cwd: string): Promise<SessionListItem[]> =>
  accion<SessionListItem[]>('chat:sessions', cwd)

/** Historial de una sesión pasada. Leerla no la reanuda. */
export const pedirTranscripcion = (cwd: string, sessionId: string): Promise<ChatMessage[]> =>
  accion<ChatMessage[]>('chats:transcript', { cwd, sessionId })

export const pedirCarpetas = (dir: string): Promise<NodoFs[]> =>
  accion<NodoFs[]>('fs:tree', { dir, depth: 1 })

// ---------- acción ----------

export const reclamar = (tabId: string): Promise<OwnerState> =>
  accion<OwnerState>('chat:claim', tabId)

export const crearPestana = (cwd: string, title?: string): Promise<TabState> =>
  accion<TabState>('tabs:create', { cwd, mode: 'chat', title })

/** Reanuda una conversación guardada en una pestaña nueva del PC. */
export const abrirSesion = (cwd: string, sessionId: string): Promise<TabState> =>
  accion<TabState>('chats:open', { cwd, sessionId })

export const enviar = (tabId: string, text: string, attachments?: ChatAttachment[]): Promise<void> =>
  accion<void>('chat:send', { tabId, text, attachments })

export const responderPermiso = (
  tabId: string,
  requestId: string,
  decision: 'allow' | 'always' | 'deny'
): Promise<void> => accion<void>('chat:permission-response', { tabId, requestId, decision })

export const responderPregunta = (
  tabId: string,
  requestId: string,
  answers: Record<string, string> | null
): Promise<void> => accion<void>('chat:question-response', { tabId, requestId, answers })

export const interrumpir = (tabId: string): Promise<void> => accion<void>('chat:interrupt', tabId)

export const ponerModelo = (tabId: string, model: string): Promise<ModelOption[]> =>
  accion<ModelOption[]>('chat:setModel', { tabId, model })

// ---------- flujo de eventos ----------

export interface LineaHola {
  tipo: 'hola'
  seq: number
  hueco: boolean
  clientId: string
  /** Versión de la app en el PC. Falta si el PC es anterior a la 0.33.2. */
  version?: string
}

export interface LineaEvento {
  tipo: 'evento'
  seq: number
  channel: string
  payload: unknown
}

/** Respuesta de un sondeo: el saludo y el lote de eventos que haya. */
interface Sondeo {
  tipo: 'sondeo'
  seq: number
  hueco: boolean
  clientId: string
  version?: string
  eventos: Array<{ seq: number; channel: string; payload: unknown }>
}

export interface ManejadoresFlujo {
  alHola: (linea: LineaHola) => void
  alEvento: (linea: LineaEvento) => void
  alLatido: () => void
  alCortar: () => void
  ultimoSeq: () => number
  /** Hasta dónde ha contado el PC, contando los eventos que no se reenvían. */
  alAvance: (seq: number) => void
}

const ESPERAS = [1000, 2000, 4000, 8000, 15000]

/**
 * Canal de eventos por sondeo largo: cada petición se queda esperando en el PC
 * hasta que hay algo que contar (o hasta que vence), contesta y se cierra.
 *
 * No es un flujo abierto y no por gusto: el túnel de Cloudflare retiene el
 * cuerpo de una respuesta que no termina —probado con relleno, como SSE y con
 * cabeceras anti-buffer, y no llega una sola línea—, así que un flujo abierto
 * deja al móvil sincronizando a mano y sin poder escribir. Tampoco se usa
 * EventSource: no admite cabeceras, y el token no puede ir en la URL porque
 * acabaría en los registros del túnel.
 */
export function abrirFlujo(m: ManejadoresFlujo): () => void {
  let cancelado = false
  let intento = 0
  let primera = true
  let control: AbortController | null = null
  let espera: number | null = null

  async function ciclo(): Promise<void> {
    while (!cancelado) {
      const s = sesion()
      if (!s) {
        expirar()
        return
      }
      control = new AbortController()
      try {
        const res = await fetch(
          `/api/eventos?sondeo=1&desde=${m.ultimoSeq()}${primera ? '&nuevo=1' : ''}`,
          {
            headers: { Authorization: `Bearer ${s.token}` },
            cache: 'no-store',
            signal: control.signal
          }
        )
        if (res.status === 401) {
          expirar()
          return
        }
        if (!res.ok) throw new Error(`estado ${res.status}`)
        const datos = (await res.json()) as Sondeo
        intento = 0
        if (primera || datos.hueco) {
          primera = false
          m.alHola({
            tipo: 'hola',
            seq: datos.seq,
            hueco: datos.hueco,
            clientId: datos.clientId,
            ...(datos.version ? { version: datos.version } : {})
          })
        } else {
          m.alLatido()
        }
        for (const ev of datos.eventos ?? []) m.alEvento({ tipo: 'evento', ...ev })
        // El seq del PC avanza también con eventos que no se reenvían: si no se
        // adoptara, cada sondeo volvería a arrastrar el mismo tramo.
        m.alAvance(datos.seq)
        continue
      } catch {
        /* cualquier corte se trata igual: se reintenta */
      }
      if (cancelado) return
      m.alCortar()
      const ms = ESPERAS[Math.min(intento, ESPERAS.length - 1)]
      intento += 1
      await new Promise<void>((seguir) => {
        espera = window.setTimeout(seguir, ms)
      })
    }
  }

  void ciclo()
  return () => {
    cancelado = true
    control?.abort()
    if (espera !== null) window.clearTimeout(espera)
  }
}
