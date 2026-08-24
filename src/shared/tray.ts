/**
 * Texto del icono de bandeja en «modo Spotify».
 *
 * Vive en shared y no en main porque es la única parte comprobable del modo
 * bandeja: todo lo demás son llamadas a Electron. Windows recorta el tooltip
 * de la bandeja a 127 caracteres, así que el resumen tiene que ser corto.
 */
export interface TrayCounts {
  /** pestañas de chat abiertas */
  chats: number
  /** pestañas de terminal abiertas */
  terminals: number
}

/** Pluraliza en español sin traer una librería para dos palabras. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Resumen que se ve al pasar el ratón por el icono de la bandeja.
 * Sin pestañas se dice explícitamente que no hay nada corriendo, para que el
 * icono no parezca un residuo de una app que ya se cerró.
 */
export function trayTooltip(counts: TrayCounts): string {
  const parts: string[] = []
  if (counts.chats > 0) parts.push(plural(counts.chats, 'chat', 'chats'))
  if (counts.terminals > 0) parts.push(plural(counts.terminals, 'terminal', 'terminales'))
  if (parts.length === 0) return 'Claude Deck — sin sesiones activas'
  return `Claude Deck — ${parts.join(' y ')} en segundo plano`
}

/** Etiqueta del ítem del menú que resume qué sigue vivo. */
export function trayStatusLabel(counts: TrayCounts): string {
  const total = counts.chats + counts.terminals
  if (total === 0) return 'Sin sesiones activas'
  return `${plural(total, 'sesión activa', 'sesiones activas')}`
}
