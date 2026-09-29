import { isAbsolute, resolve, sep } from 'node:path'
import { accionRemota } from './api'

/**
 * Decide qué se hace con una petición remota antes de que toque nada del main:
 * si el canal está permitido, si el dispositivo tiene el control, y si las
 * rutas que trae caen dentro de lo permitido.
 *
 * Está separado del servidor a propósito. Las reglas de esta clase son la
 * frontera de seguridad, y tienen que poder probarse sin abrir un puerto.
 */

export type MotivoRechazo = 'no-permitido' | 'sin-control' | 'ruta-fuera' | 'fallo'

export interface Respuesta {
  ok: boolean
  data?: unknown
  error?: string
  motivo?: MotivoRechazo
}

export interface DispatchDeps {
  /** Ejecuta la acción ya autorizada. Recibe quién la pide: hay acciones que
   *  solo tienen sentido para un dispositivo concreto. */
  invocar: (canal: string, args: unknown, clientId: string) => Promise<unknown> | unknown
  /** ¿Este cliente puede enviar/aprobar en esta conversación? */
  puedeActuar: (tabId: string, clientId: string) => boolean
  /** Carpetas dentro de las que el acceso remoto puede mirar. */
  raices: () => string[]
}

/**
 * Un id de sesión es un uuid. Se comprueba porque con él se compone el nombre
 * del .jsonl que se va a leer: sin esto, un `..` dentro del id sacaría la
 * lectura de la carpeta del proyecto.
 */
const ID_SESION = /^[A-Za-z0-9-]{8,64}$/

/** Claves de los argumentos que llevan una ruta del disco. */
const CLAVES_RUTA = ['dir', 'cwd', 'rootPath', 'path'] as const

function tabIdDe(args: unknown): string | null {
  if (typeof args === 'string') return args
  if (args && typeof args === 'object') {
    const t = (args as { tabId?: unknown }).tabId
    if (typeof t === 'string') return t
  }
  return null
}

function rutasDe(args: unknown): string[] {
  if (typeof args === 'string') return [args]
  if (!args || typeof args !== 'object') return []
  const out: string[] = []
  for (const k of CLAVES_RUTA) {
    const v = (args as Record<string, unknown>)[k]
    if (typeof v === 'string' && v) out.push(v)
  }
  return out
}

/**
 * ¿La ruta cae dentro de alguna raíz? Se compara la ruta ya resuelta, así que
 * un `..` intermedio no sirve para salirse. En Windows se compara sin distinguir
 * mayúsculas, porque el mismo directorio se escribe de varias formas.
 */
export function dentroDeRaices(ruta: string, raices: string[]): boolean {
  if (!isAbsolute(ruta)) return false
  const r = resolve(ruta).toLowerCase()
  return raices.some((raiz) => {
    const base = resolve(raiz).toLowerCase()
    return r === base || r.startsWith(base.endsWith(sep) ? base : base + sep)
  })
}

export class Dispatcher {
  constructor(private deps: DispatchDeps) {}

  async atender(canal: string, args: unknown, clientId: string): Promise<Respuesta> {
    const accion = accionRemota(canal)
    if (!accion) {
      // Mismo mensaje para un canal inexistente y para uno vetado: no hay que
      // ayudar a mapear la superficie desde fuera.
      return { ok: false, motivo: 'no-permitido', error: 'Acción no disponible' }
    }

    const restr = accion.restricciones ?? []

    if (restr.includes('confinar-raiz')) {
      const raices = this.deps.raices()
      const rutas = rutasDe(args)
      if (rutas.some((r) => !dentroDeRaices(r, raices))) {
        return {
          ok: false,
          motivo: 'ruta-fuera',
          error: 'Esa carpeta no está disponible para el acceso remoto'
        }
      }
    }

    if (restr.includes('id-sesion')) {
      const id = (args as { sessionId?: unknown } | null)?.sessionId
      if (typeof id !== 'string' || !ID_SESION.test(id)) {
        return { ok: false, motivo: 'fallo', error: 'Identificador de conversación no válido' }
      }
    }

    if (accion.control) {
      const tabId = tabIdDe(args)
      if (!tabId) return { ok: false, motivo: 'fallo', error: 'Falta la conversación' }
      if (!this.deps.puedeActuar(tabId, clientId)) {
        return {
          ok: false,
          motivo: 'sin-control',
          error: 'El control lo tiene otro dispositivo'
        }
      }
    }

    let finales = args
    if (restr.includes('forzar-chat') && args && typeof args === 'object') {
      // El terminal no se abre desde fuera, ni por descuido ni por insistencia.
      const { cli: _cli, cliCommand: _cmd, ...resto } = args as Record<string, unknown>
      finales = { ...resto, mode: 'chat' }
    }

    try {
      return { ok: true, data: await this.deps.invocar(canal, finales, clientId) }
    } catch (err) {
      return { ok: false, motivo: 'fallo', error: String((err as Error)?.message ?? err) }
    }
  }
}
