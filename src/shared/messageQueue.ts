/**
 * Cola de mensajes del chat.
 *
 * Mientras Claude responde, el composer no se bloquea: lo que se escribe se
 * encola y sale solo cuando termina el turno. Aquí vive la lógica pura para
 * poder probarla sin React ni Electron; el estado de "ocupado" y el envío
 * real siguen siendo del componente.
 */

import type { ChatAttachment } from './types'

/**
 * Extiende `ChatAttachment` en vez de redeclarar los campos: `mediaType` es
 * una unión de literales, y copiarlo como `string` hacía que la cola no se
 * pudiera devolver al envío sin un cast.
 */
export interface QueuedAttachment extends ChatAttachment {
  /** copia para la miniatura; no viaja al SDK */
  dataUrl: string
}

export interface QueuedMessage {
  id: string
  text: string
  attachments: QueuedAttachment[]
  /** instante en que se encoló (ms) */
  queuedAt: number
}

/**
 * Tope de la cola. No es una restricción del SDK: es un freno para que un
 * Enter repetido por impaciencia (o un bucle que dispare `deck:chat-insert`)
 * no acumule cientos de mensajes que luego se envíen en cadena sin que nadie
 * los revise.
 */
export const MAX_QUEUE = 25

export function canQueue(queue: QueuedMessage[]): boolean {
  return queue.length < MAX_QUEUE
}

/**
 * Añade al final. Devuelve la cola sin tocar si está llena o si el mensaje
 * está vacío — un mensaje sin texto ni adjuntos no tiene nada que enviar.
 */
export function enqueue(queue: QueuedMessage[], msg: QueuedMessage): QueuedMessage[] {
  if (!canQueue(queue)) return queue
  if (!msg.text.trim() && msg.attachments.length === 0) return queue
  return [...queue, msg]
}

/**
 * Saca el primero. Devuelve `next: null` con la cola vacía en vez de lanzar,
 * porque el drenado corre dentro de un efecto que puede dispararse de más.
 */
export function dequeue(queue: QueuedMessage[]): {
  next: QueuedMessage | null
  rest: QueuedMessage[]
} {
  if (queue.length === 0) return { next: null, rest: queue }
  return { next: queue[0], rest: queue.slice(1) }
}

/** Quita por id. Si el id no está, devuelve la MISMA referencia: así el
 *  efecto de drenado no se vuelve a disparar por un borrado que no existió. */
export function removeQueued(queue: QueuedMessage[], id: string): QueuedMessage[] {
  const out = queue.filter((m) => m.id !== id)
  return out.length === queue.length ? queue : out
}

/**
 * Etiqueta de una línea para la lista de la cola. Colapsa los saltos porque
 * un mensaje largo pegado rompería la altura de la fila del widget.
 */
export function queueLabel(msg: QueuedMessage, max = 70): string {
  const plano = msg.text.replace(/\s+/g, ' ').trim()
  if (!plano) {
    const n = msg.attachments.length
    return n === 1 ? '📎 1 imagen' : `📎 ${n} imágenes`
  }
  const corto = plano.length > max ? `${plano.slice(0, max - 1).trimEnd()}…` : plano
  return msg.attachments.length > 0 ? `📎 ${corto}` : corto
}
