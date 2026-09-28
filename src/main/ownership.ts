import type { Emitter } from './bus'
import type { OwnerState } from '../shared/types'

/** El PC: la ventana de Electron siempre cuenta como este cliente. */
export const CLIENTE_LOCAL = 'local'

/**
 * Control blando de cada conversación.
 *
 * Los dos dispositivos ven todo en vivo, pero solo uno envía y aprueba a la
 * vez. El otro no queda fuera: reclama el control de un toque y pasa a ser el
 * dueño. No hay negociación ni bloqueo con caducidad — el relevo es inmediato,
 * porque detrás de los dos dispositivos hay una sola persona.
 *
 * La propiedad se toma sola con la primera acción: nadie tiene que pedirla para
 * empezar a trabajar. Y un dueño que ya no está conectado no bloquea a nadie,
 * así el móvil no se queda mirando un control que tiene el PC apagado.
 */
export class Ownership {
  private clientes = new Map<string, string>()
  private duenos = new Map<string, { clientId: string; since: number }>()

  constructor(private bus: Emitter) {
    this.clientes.set(CLIENTE_LOCAL, 'Este PC')
  }

  register(clientId: string, label: string): void {
    this.clientes.set(clientId, label)
  }

  /**
   * Un cliente que se va suelta lo que tenía. Sin esto, cerrar el navegador del
   * móvil dejaría conversaciones con un dueño inalcanzable.
   */
  unregister(clientId: string): void {
    if (clientId === CLIENTE_LOCAL) return
    this.clientes.delete(clientId)
    for (const [tabId, d] of this.duenos) {
      if (d.clientId !== clientId) continue
      this.duenos.delete(tabId)
      this.bus.send('chat:owner', { tabId, owner: null })
    }
  }

  /** Quién manda en una conversación, o null si está libre. */
  owner(tabId: string): OwnerState | null {
    const d = this.duenos.get(tabId)
    if (!d) return null
    return {
      tabId,
      clientId: d.clientId,
      label: this.clientes.get(d.clientId) ?? d.clientId,
      since: d.since,
      connected: this.clientes.has(d.clientId)
    }
  }

  list(): OwnerState[] {
    return [...this.duenos.keys()].map((t) => this.owner(t)!).filter(Boolean)
  }

  /**
   * ¿Puede este cliente enviar o aprobar en esta conversación? Si puede y aún
   * no era el dueño, lo pasa a serlo: la propiedad se toma actuando.
   *
   * Solo dice no cuando el dueño es otro cliente y sigue conectado. Con el PC
   * como único cliente eso no puede ocurrir, así que el comportamiento sin
   * dispositivos emparejados es exactamente el de siempre.
   */
  puedeActuar(tabId: string, clientId: string): boolean {
    const d = this.duenos.get(tabId)
    if (d && d.clientId !== clientId && this.clientes.has(d.clientId)) return false
    if (!d || d.clientId !== clientId) this.tomar(tabId, clientId)
    return true
  }

  /** Relevo explícito: el botón de «tomar el control». */
  claim(tabId: string, clientId: string): OwnerState {
    const previo = this.duenos.get(tabId)
    if (previo?.clientId !== clientId) this.tomar(tabId, clientId)
    return this.owner(tabId)!
  }

  private tomar(tabId: string, clientId: string): void {
    this.duenos.set(tabId, { clientId, since: Date.now() })
    this.bus.send('chat:owner', { tabId, owner: this.owner(tabId) })
  }

  /** Al cerrar una pestaña no queda propiedad huérfana que reaparezca. */
  forget(tabId: string): void {
    this.duenos.delete(tabId)
  }
}
