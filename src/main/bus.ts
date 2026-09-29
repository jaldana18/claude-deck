import type { BrowserWindow } from 'electron'

/**
 * Salida de eventos del main hacia quien esté escuchando.
 *
 * Hasta ahora cada módulo recibía `getWindow()` y emitía contra la única
 * ventana de Electron. El acceso remoto añade clientes que no son ventanas, así
 * que los módulos pasan a depender de esta interfaz y dejan de saber a cuántos
 * destinatarios llega lo que emiten.
 */
export interface Emitter {
  /** Devuelve a cuántos destinos llegó: 0 significa que nadie escuchaba. */
  send(channel: string, payload: unknown): number
}

export interface BusEvent {
  seq: number
  channel: string
  payload: unknown
}

export type Sink = (ev: BusEvent) => void

/**
 * Reparte los eventos a la ventana local y a los clientes remotos, y conserva
 * los últimos para que un cliente que se reconecte pueda pedir lo que se perdió.
 *
 * El anillo es deliberadamente corto: `chat:delta` emite cada 100 ms mientras
 * Claude escribe, así que cubre segundos, no minutos. Es suficiente para un
 * túnel que se cae y vuelve; una desconexión larga se resuelve pidiendo el
 * snapshot completo de la sesión, no reproduciendo el historial.
 */
export class Bus implements Emitter {
  private seq = 0
  private ring: BusEvent[] = []
  private sinks = new Set<Sink>()
  private observadores = new Set<Sink>()

  constructor(
    private getWindow: () => BrowserWindow | null,
    private ringCap = 500
  ) {}

  send(channel: string, payload: unknown): number {
    const ev: BusEvent = { seq: ++this.seq, channel, payload }
    let entregados = 0

    this.ring.push(ev)
    // Se recorta por lotes: hacerlo en cada evento cuesta O(n) por emisión.
    if (this.ring.length > this.ringCap * 1.5) {
      this.ring.splice(0, this.ring.length - this.ringCap)
    }

    try {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload)
        entregados++
      }
    } catch {
      /* ventana cerrándose */
    }

    for (const sink of this.sinks) {
      try {
        sink(ev)
        entregados++
      } catch {
        /* un cliente remoto caído no puede tumbar a los demás */
      }
    }

    for (const obs of this.observadores) {
      try {
        obs(ev)
      } catch {
        /* un observador roto no puede impedir la entrega */
      }
    }

    return entregados
  }

  subscribe(sink: Sink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  /**
   * Observador interno del main —avisos nativos del sistema, por ejemplo—. Ve
   * todos los eventos pero NO cuenta como destinatario: no es nadie mirando una
   * pantalla, y si contara, el updater daría por avisada una versión que nadie
   * llegó a ver.
   */
  observe(sink: Sink): () => void {
    this.observadores.add(sink)
    return () => this.observadores.delete(sink)
  }

  /** Eventos posteriores a `seq` que siguen en el anillo. */
  since(seq: number): BusEvent[] {
    return this.ring.filter((e) => e.seq > seq)
  }

  /**
   * Si `seq` ya salió del anillo no hay forma de completar el hueco y el
   * cliente debe rehidratarse con un snapshot.
   */
  hasGapSince(seq: number): boolean {
    if (seq >= this.seq) return false
    const oldest = this.ring[0]
    return !oldest || oldest.seq > seq + 1
  }

  get lastSeq(): number {
    return this.seq
  }
}
