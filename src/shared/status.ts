/**
 * Lógica pura del vigilante de estado. Vive en shared/ —y no dentro de
 * main/status.ts— para poder probarla sin levantar Electron ni tocar la red.
 */
import type { ModelFault, ServiceLevel, StatusReport } from './types'
import { familyOf, labelFor, type ModelFamily } from './models'

/** Ventana de observación de los fallos locales: más viejo que esto, se olvida */
export const VENTANA_FALLOS_MS = 10 * 60 * 1000

/** Fallos contra el mismo modelo que hacen falta para darlo por caído */
export const UMBRAL_FALLOS = 3

/**
 * Traduce las etiquetas de Statuspage a nuestra escala. Statuspage usa
 * `degraded_performance`, `partial_outage`, `major_outage` y
 * `under_maintenance` por componente.
 */
export function nivelDeComponente(raw: string): ServiceLevel {
  switch (raw) {
    case 'operational':
      return 'operational'
    case 'degraded_performance':
      return 'degraded'
    case 'partial_outage':
      return 'partial'
    case 'major_outage':
      return 'major'
    case 'under_maintenance':
      return 'maintenance'
    default:
      return 'unknown'
  }
}

/** El indicador global usa otra escala distinta a la de los componentes */
export function nivelGlobal(indicator: string): ServiceLevel {
  switch (indicator) {
    case 'none':
      return 'operational'
    case 'minor':
      return 'degraded'
    case 'major':
      return 'partial'
    case 'critical':
      return 'major'
    case 'maintenance':
      return 'maintenance'
    default:
      return 'unknown'
  }
}

/**
 * El status oficial no tiene componentes por modelo: sus componentes son
 * servicios enteros. Cuando un incidente afecta a un modelo concreto, el dato
 * solo está en la prosa del parte. Esto lo saca de ahí, así que es una pista
 * orientativa, no una verdad.
 */
export function familiasCitadas(texto: string): ModelFamily[] {
  const t = texto.toLowerCase()
  const out = new Set<ModelFamily>()
  if (/\bfable\b|\bmythos\b/.test(t)) out.add('fable')
  if (/\bopus\b/.test(t)) out.add('opus')
  if (/\bsonnet\b/.test(t)) out.add('sonnet')
  if (/\bhaiku\b/.test(t)) out.add('haiku')
  return [...out]
}

/** Descarta los fallos que ya salieron de la ventana de observación */
export function fallosVigentes(
  fallos: ModelFault[],
  ahora: number,
  ventanaMs = VENTANA_FALLOS_MS
): ModelFault[] {
  const corte = ahora - ventanaMs
  return fallos.filter((f) => f.at >= corte)
}

/**
 * Modelos que superan el umbral de fallos dentro de la ventana.
 *
 * El umbral existe porque un 529 suelto no es una caída: la API los emite bajo
 * carga normal y el SDK reintenta solo. Avisar al primero convertiría el banner
 * en ruido y dejaría de leerse, que es la única forma de que un aviso falle.
 */
export function modelosDegradados(
  fallos: ModelFault[],
  umbral = UMBRAL_FALLOS,
  ahora = Date.now(),
  ventanaMs = VENTANA_FALLOS_MS
): string[] {
  const cuenta = new Map<string, number>()
  for (const f of fallosVigentes(fallos, ahora, ventanaMs)) {
    cuenta.set(f.model, (cuenta.get(f.model) ?? 0) + 1)
  }
  return [...cuenta.entries()]
    .filter(([, n]) => n >= umbral)
    .map(([m]) => m)
    .sort()
}

/** Construye la entrada de fallo, resolviendo la familia del modelo */
export function nuevoFallo(
  model: string | undefined,
  status: number | null,
  message: string,
  at = Date.now()
): ModelFault {
  const m = model || 'default'
  return { model: m, family: familyOf(m), status, message: message.slice(0, 200), at }
}

/**
 * Resume el informe de estado en una línea. Devuelve null cuando no hay nada
 * que decir: el banner solo debe aparecer si algo va mal de verdad.
 *
 * Se distinguen dos cosas que la gente confunde: lo que Anthropic ha reconocido
 * públicamente (tarda, y es por servicio entero) y lo que está fallando en esta
 * máquina ahora mismo (inmediato, y sí sabe qué modelo era).
 */
export function resumirEstado(
  r: StatusReport | null
): { firma: string; tono: 'aviso' | 'grave'; texto: string; url?: string } | null {
  if (!r) return null
  const incidentes = r.incidents.filter((i) => i.stage !== 'resolved')
  const local = r.degraded
  if (local.length === 0 && incidentes.length === 0) return null

  const firma = [local.join(','), incidentes.map((i) => `${i.id}:${i.stage}`).join(',')].join('|')
  const partes: string[] = []

  if (local.length > 0) {
    const nombres = local.map((m) => labelFor(m)).join(', ')
    const n = r.faults.filter((f) => local.includes(f.model)).length
    partes.push(
      `${nombres} ${local.length > 1 ? 'están fallando' : 'está fallando'} en este equipo: ` +
        `${n} ${n === 1 ? 'error' : 'errores'} de API en los últimos minutos.`
    )
  }
  if (incidentes.length > 0) {
    const i = incidentes[0]
    const familias = i.families.length > 0 ? ` (afecta a ${i.families.join(', ')})` : ''
    partes.push(`Anthropic reporta: ${i.name}${familias}.`)
  } else if (local.length > 0) {
    partes.push('El status oficial no reporta ninguna incidencia todavía.')
  }

  const grave =
    incidentes.some((i) => i.impact === 'critical' || i.impact === 'major') || local.length > 1
  return {
    firma,
    tono: grave ? 'grave' : 'aviso',
    texto: partes.join(' '),
    url: incidentes[0]?.url
  }
}
