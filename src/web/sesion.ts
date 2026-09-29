import * as api from './api'
import { TEMA_CONEXION, TEMA_TABS, tienda } from './estado'

/**
 * Ciclo de vida de la conexión con el PC: el flujo de eventos, la rehidratación
 * y las notificaciones. Lo usan la pantalla de emparejamiento y el arranque.
 */

/** Código que venía en la URL de invitación, para emparejar sin teclear. */
export const arranque: { codigo: string | null } = { codigo: null }

let cerrarFlujo: (() => void) | null = null

export function sesionViva(): boolean {
  return cerrarFlujo !== null
}

export function arrancarSesion(): void {
  if (cerrarFlujo) return
  tienda.miClientId = api.sesion()?.clientId ?? ''
  cerrarFlujo = api.abrirFlujo({
    ultimoSeq: () => tienda.ultimoSeq,
    alHola: (linea) => {
      tienda.conectado = true
      // En la primera conexión se salta al presente; al reconectar NO se toca,
      // porque los eventos recuperados vienen después de esta línea y adelantar
      // el contador se los saltaría si la conexión se cortara otra vez.
      if (tienda.ultimoSeq === 0 || linea.hueco) tienda.ultimoSeq = linea.seq
      tienda.miClientId = linea.clientId
      // El PC dice su versión al saludar: si no es la de este cliente, el móvil
      // está corriendo un cliente viejo servido desde la caché.
      tienda.versionNueva =
        linea.version && linea.version !== __VERSION__ ? linea.version : null
      tienda.marcar(TEMA_CONEXION)
      void rehidratar(linea.hueco)
    },
    alEvento: (linea) => {
      tienda.ultimoSeq = Math.max(tienda.ultimoSeq, linea.seq)
      tienda.aplicar(linea.channel, linea.payload)
    },
    alLatido: () => {
      if (tienda.conectado) return
      tienda.conectado = true
      tienda.marcar(TEMA_CONEXION)
    },
    alAvance: (seq) => {
      tienda.ultimoSeq = Math.max(tienda.ultimoSeq, seq)
    },
    alCortar: () => {
      tienda.conectado = false
      tienda.marcar(TEMA_CONEXION)
    }
  })
}

/** Reconexión inmediata sin perder lo que ya se está mostrando. */
export function reintentarAhora(): void {
  if (!cerrarFlujo) return
  cerrarFlujo()
  cerrarFlujo = null
  arrancarSesion()
}

export function pararSesion(): void {
  cerrarFlujo?.()
  cerrarFlujo = null
  tienda.conectado = false
  tienda.ultimoSeq = 0
  tienda.lista = []
  tienda.chats.clear()
  tienda.marcar(TEMA_CONEXION, TEMA_TABS)
}

/**
 * Con `hueco` se perdieron eventos del medio: lo que llegue a partir de ahora no
 * basta para reconstruir la conversación, así que se piden los snapshots y el
 * historial de lo que estuviera abierto.
 */
async function rehidratar(hueco: boolean): Promise<void> {
  try {
    await tienda.cargarBase()
    if (hueco) await tienda.recargarAbiertos()
  } catch {
    /* si esto falla, la banda de desconectado ya lo está diciendo */
  }
}

/**
 * Trae el cliente nuevo: se borra la caché del armazón y se recarga. El HTML se
 * pide a la red, así que basta con no dejar que responda la copia guardada.
 */
export async function actualizarCliente(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.getRegistration()
      await registro?.update()
    }
    if ('caches' in window) {
      const nombres = await caches.keys()
      await Promise.all(nombres.map((n) => caches.delete(n)))
    }
  } catch {
    /* recargar de todos modos: el HTML va a la red antes que a la caché */
  }
  location.reload()
}

// ---------- notificaciones ----------

export async function pedirNotificaciones(): Promise<void> {
  if (!('Notification' in window)) return
  try {
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission === 'granted') await suscribirPush()
  } catch {
    /* algunos navegadores lo rechazan sin gesto del usuario */
  }
}

/**
 * Suscripción a Web Push: es la única forma de que llegue un aviso con la app
 * cerrada del todo, porque entonces no hay flujo de eventos ni nadie mirando.
 *
 * La suscripción pertenece a este origen. Con túnel rápido el origen cambia en
 * cada arranque del PC, así que allí muere con la dirección; con dominio propio
 * sobrevive.
 */
async function suscribirPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  const registro = await navigator.serviceWorker.ready
  const clave = await api.accion<string>('remote:pushKey')
  if (!clave) return
  const sub =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlABytes(clave)
    }))
  await api.accion('remote:pushSubscribe', sub.toJSON())
}

/** La clave VAPID viaja en base64url y `subscribe` la quiere en bytes. */
function base64UrlABytes(b64: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4)
  const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(crudo.length)
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return bytes.buffer
}

export function conectarNotificaciones(): void {
  tienda.alAtencion = (tabId, titulo, cuerpo) => void notificar(tabId, titulo, cuerpo)
}

async function notificar(tabId: string, titulo: string, cuerpo: string): Promise<void> {
  // Con la app delante no se notifica: la tarjeta ya está en pantalla.
  if (!document.hidden) return
  if (Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return
  const registro = await navigator.serviceWorker.getRegistration()
  if (!registro) return
  const nombre = tienda.entrada(tabId)?.tab.title ?? 'Conversación'
  await registro.showNotification(`${titulo} · ${nombre}`, {
    body: cuerpo,
    tag: `deck-${tabId}`,
    icon: './icono.svg',
    badge: './icono.svg',
    data: { ruta: `#/chat/${tabId}` }
  })
}
