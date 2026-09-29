/**
 * Superficie remota: lo único que un dispositivo por internet puede pedir y
 * recibir.
 *
 * El IPC interno son ~110 canales entre dos procesos que se confían todo, y
 * varios de ellos son ejecución de código arbitrario en el PC. Publicarlo tal
 * cual —un puente genérico que reenvíe cualquier canal— sería regalar la
 * máquina a cambio de escribir menos código aquí. Así que esto no es un filtro
 * sobre el IPC: es una API distinta, más pequeña, que se declara entera a mano.
 *
 * La regla para añadir algo: si el peor uso posible de ese canal en manos de
 * quien robe el token es aceptable, entra. Si no, no entra, aunque sea cómodo.
 */

/** Restricciones que el gateway tiene que aplicar además de permitir la acción. */
export type Restriccion =
  /** La ruta recibida se confina a las carpetas ya conocidas: sin esto es un
   *  listado del disco entero. */
  | 'confinar-raiz'
  /** El modo se fuerza a chat: el terminal remoto está fuera de alcance. */
  | 'forzar-chat'

export interface AccionRemota {
  /** Canal IPC que atiende la petición. */
  canal: string
  /** Exige tener el control de la conversación (dueño blando con relevo). */
  control: boolean
  restricciones?: Restriccion[]
  /**
   * La resuelve el propio gateway y no existe como canal IPC: solo tiene sentido
   * para un cliente remoto (su clave de avisos, su suscripción).
   */
  interna?: boolean
}

/**
 * Peticiones permitidas. El `control` va aquí y no en el handler porque el mismo
 * canal lo usa el PC, que se comprueba en su propio borde.
 *
 * Solo está lo que el cliente web usa de verdad. Los comandos, los modelos y la
 * salud, por ejemplo, ya viajan dentro del snapshot: publicarlos además como
 * acción sería superficie de ataque a cambio de nada.
 */
export const ACCIONES_REMOTAS: readonly AccionRemota[] = [
  // ----- leer -----
  { canal: 'tabs:list', control: false },
  { canal: 'chat:snapshot', control: false },
  { canal: 'chat:snapshotAll', control: false },
  { canal: 'chat:history', control: false },
  { canal: 'chat:owners', control: false },
  // Listado de carpetas para elegir dónde abrir un chat. El diálogo nativo no
  // sirve desde fuera: abriría una ventana en un PC donde no hay nadie.
  { canal: 'fs:tree', control: false, restricciones: ['confinar-raiz'] },
  // Por dónde puede empezar a navegar: sin esto el móvil no sabría qué pedir.
  { canal: 'remote:raices', control: false },
  // Avisos con la app cerrada: el dispositivo pide la clave y entrega su
  // suscripción. No expone nada del PC.
  { canal: 'remote:pushKey', control: false, interna: true },
  { canal: 'remote:pushSubscribe', control: false, interna: true },

  // ----- actuar -----
  // Reclamar el control nunca puede exigir tenerlo: es el relevo.
  { canal: 'chat:claim', control: false },
  { canal: 'tabs:create', control: false, restricciones: ['confinar-raiz', 'forzar-chat'] },
  { canal: 'chat:send', control: true },
  { canal: 'chat:permission-response', control: true },
  { canal: 'chat:question-response', control: true },
  { canal: 'chat:interrupt', control: true },
  { canal: 'chat:setModel', control: true }
]

/**
 * Canales cuya exposición remota está vetada, con el motivo. No es la lista
 * completa de lo que queda fuera —fuera está todo lo que no esté permitido—
 * sino los que más tienta reenviar y peor acaban.
 */
export const VETADOS: Readonly<Record<string, string>> = {
  'logs:spawn': 'lanza un proceso arbitrario en el PC',
  'pty:input': 'escribe en un terminal vivo: ejecución directa',
  'pty:attach': 'abre un terminal, que es el mismo agujero por otra puerta',
  'store:plugin': 'instala código de terceros',
  'open:target': 'abre cualquier ruta o URL con el programa asociado',
  'update:install': 'ejecuta un instalador',
  'config:preview': 'lee cualquier archivo del disco por ruta absoluta',
  'file:attach': 'lee cualquier archivo del disco por ruta absoluta',
  'config:toggleHook': 'modifica los hooks que se ejecutan en cada turno',
  'config:installDeckHooks': 'escribe hooks en la configuración del proyecto',
  'artifact:create': 'escribe agentes y skills que luego se ejecutan',
  'store:importAgents': 'escribe agentes que luego se ejecutan',
  'store:importSkill': 'escribe skills que luego se ejecutan',
  'cli:setDefault': 'cambia qué binario se lanza al abrir una pestaña',
  'settings:set': 'ajustes globales de la app',
  'chat:setPermissionMode':
    'subir a permisos automáticos desde el móvil convierte un token robado en control total',
  'app:quit': 'apaga el PC que ejecuta todo'
}

/** Eventos que un cliente remoto puede recibir. */
export const EVENTOS_REMOTOS: readonly string[] = [
  'chat:stream-start',
  'chat:delta',
  'chat:message',
  'chat:tool-result',
  'chat:result',
  'chat:error',
  'chat:health',
  'chat:permission-request',
  'chat:permission-cancel',
  'chat:question',
  'chat:question-cancel',
  'chat:commands',
  'chat:models',
  'chat:init-model',
  'chat:todos',
  'chat:auto-compact',
  'chat:auto-continue',
  'chat:agent-done',
  'chat:subagent-batch',
  'chat:owner',
  'tab:state',
  'tab:list',
  'tab:status',
  'tab:session',
  'status:changed'
]

const porCanal = new Map(ACCIONES_REMOTAS.map((a) => [a.canal, a]))
const eventos = new Set(EVENTOS_REMOTOS)

/** La acción, o null si no está permitida. Null significa no, nunca «quizá». */
export function accionRemota(canal: string): AccionRemota | null {
  return porCanal.get(canal) ?? null
}

export function eventoRemoto(canal: string): boolean {
  return eventos.has(canal)
}
