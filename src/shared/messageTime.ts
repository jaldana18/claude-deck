/**
 * Formato de fecha/hora de los mensajes y de duración de los agentes.
 *
 * Vive en shared/ y no usa `Intl` para las etiquetas cortas a propósito: el
 * mismo código corre en el proceso principal, en el renderer y en los tests de
 * Node, y `toLocaleDateString` da resultados distintos según la ICU de cada
 * runtime. Un formato propio es feo de escribir una vez y estable siempre.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const dos = (n: number): string => (n < 10 ? `0${n}` : String(n))

/**
 * Etiqueta corta para la burbuja: `14:32` si el mensaje es de hoy, `24 ago,
 * 14:32` si es de otro día.
 *
 * Se omite el año salvo que el mensaje sea de otro año distinto al de `now`:
 * en una conversación reanudada al día siguiente el año solo estorba, pero en
 * un historial de hace meses saber que es de 2025 sí importa.
 *
 * Devuelve '' si no hay marca o no se puede parsear, para que quien renderiza
 * simplemente no pinte nada.
 */
export function formatMessageTime(iso: string | undefined, now: Date = new Date()): string {
  const d = parseIso(iso)
  if (!d) return ''
  const hora = `${dos(d.getHours())}:${dos(d.getMinutes())}`
  if (mismoDia(d, now)) return hora
  const fecha = `${d.getDate()} ${MESES[d.getMonth()]}`
  const anio = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${fecha}${anio}, ${hora}`
}

/**
 * Fecha y hora completas para el `title` de la burbuja. Aquí sí se usa el
 * formato local del sistema: es texto de ayuda, no entra en ningún test y
 * conviene que respete las preferencias del usuario.
 */
export function formatFullTime(iso: string | undefined): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    return d.toLocaleString()
  } catch {
    return d.toISOString()
  }
}

/**
 * Duración legible de un agente: `8s`, `1m 12s`, `1h 04m`.
 *
 * Por debajo de un minuto se muestran segundos porque la mayoría de agentes
 * cortos viven ahí y un `0m` no diría nada. A partir de una hora se ocultan
 * los segundos: a esa escala solo añaden ruido que cambia cada tick.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const min = Math.floor(total / 60)
  const seg = total % 60
  if (min < 60) return `${min}m ${dos(seg)}s`
  return `${Math.floor(min / 60)}h ${dos(min % 60)}m`
}

/**
 * Duración de una ejecución que puede seguir en curso. `end` ausente significa
 * «todavía corriendo», así que se mide contra `now`.
 *
 * Devuelve '' cuando no hay inicio conocido: es preferible no pintar nada a
 * pintar un cronómetro que arranca de cero cada vez que se recarga la pestaña.
 */
export function runDuration(start?: number, end?: number, now: number = Date.now()): string {
  if (!start || !Number.isFinite(start)) return ''
  return formatDuration((end ?? now) - start)
}

function parseIso(iso: string | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
