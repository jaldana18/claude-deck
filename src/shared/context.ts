/**
 * Ventana de contexto por modelo y decisión de auto-compactación.
 *
 * Vive en shared/ (sin dependencias de Electron) para poder testearse: es la
 * lógica que decide cuándo gastar dinero, y equivocarse aquí sale caro en las
 * dos direcciones — compactar de más pierde contexto y dispara turnos extra,
 * compactar de menos deja la conversación creciendo hasta cientos de miles de
 * tokens que se releen (y se cobran) en CADA turno posterior.
 */

/** Ventana por defecto cuando no se reconoce el modelo (la conservadora) */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Tope de compactaciones automáticas encadenadas sin intervención del usuario */
export const MAX_AUTO_COMPACTS = 3

/**
 * Tamaño real de la ventana de contexto del modelo.
 *
 * Antes se asumía 200k salvo sufijo `[1m]`, pero los modelos actuales (Opus
 * 4.6+, Sonnet 4.6+, Fable/Mythos 5) ya son de 1M sin sufijo alguno: con el
 * cálculo viejo el auto-compact saltaba con el 80 % de la ventana todavía
 * libre. Los que siguen en 200k son Haiku y la generación 4.5 y anteriores.
 */
export function contextWindowFor(model?: string): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW
  const m = model.toLowerCase()
  // El sufijo [1m] es explícito y gana sobre cualquier heurística
  if (m.includes('[1m]')) return 1_000_000
  // Haiku sigue en 200k en todas sus versiones publicadas
  if (m.includes('haiku')) return DEFAULT_CONTEXT_WINDOW
  // Familias de 1M por defecto
  if (/fable|mythos/.test(m)) return 1_000_000
  if (/opus-(5|4-6|4-7|4-8)/.test(m)) return 1_000_000
  if (/sonnet-(5|4-6)/.test(m)) return 1_000_000
  // Alias sin versión (opus / sonnet a secas): el CLI los resuelve al modelo
  // actual de esa familia, que hoy es de 1M
  if (/^(claude-)?(opus|sonnet)(\[|$)/.test(m)) return 1_000_000
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Normaliza el `utilization` del rate_limit_event a porcentaje 0-100.
 *
 * El SDK no documenta la unidad y no hay dato local con el que comprobarla,
 * así que se aceptan las dos convenciones: un valor de 0 a 1 se toma como
 * fracción y cualquier cosa mayor como porcentaje ya hecho. El único caso
 * ambiguo es el 1 exacto (¿1 % o 100 %?), y ahí se elige 100 % porque errar
 * avisando de más es preferible a decir que queda cuota cuando no queda.
 */
export function normalizeUtilization(u: number | undefined): number {
  if (typeof u !== 'number' || !Number.isFinite(u) || u < 0) return 0
  const pct = u <= 1 ? u * 100 : u
  return Math.min(100, Math.round(pct))
}

/** Etiqueta corta de cada ventana de límite para los chips del widget */
export function rateLimitLabel(type: string): string {
  switch (type) {
    case 'five_hour':
      return 'Sesión'
    case 'seven_day':
      return 'Semana'
    case 'seven_day_opus':
      return 'Semana Opus'
    case 'seven_day_sonnet':
      return 'Semana Sonnet'
    case 'overage':
    case 'seven_day_overage_included':
      return 'Extra'
    default:
      return type
  }
}

export interface CompactThresholdInput {
  /** Ventana del modelo activo */
  window: number
  /** Umbral absoluto global en tokens (ajustes de la app; 0/undefined = off) */
  globalTokens?: number
  /** Umbral absoluto de la pestaña, si el usuario lo fijó (gana sobre el global) */
  tabTokens?: number
  /** Umbral en % de la pestaña (modo antiguo; solo si no hay absolutos) */
  tabPct?: number
}

/**
 * Umbral efectivo en TOKENS a partir del cual compactar. 0 = desactivado.
 *
 * Precedencia: absoluto de la pestaña → % de la pestaña → absoluto global.
 * El absoluto es el modo preferido porque no depende de acertar la ventana
 * del modelo, que es justo lo que estaba mal antes.
 */
export function resolveCompactThreshold(i: CompactThresholdInput): number {
  // La pestaña manda: un valor <= 0 es un «off» explícito, no un «sin definir».
  // Sin esta distinción no habría forma de apagar el auto-compact en una
  // pestaña concreta teniendo el global activo.
  if (i.tabTokens !== undefined) return i.tabTokens > 0 ? i.tabTokens : 0
  if (i.tabPct && i.tabPct > 0 && i.window > 0) return Math.round((i.window * i.tabPct) / 100)
  if (i.globalTokens && i.globalTokens > 0) return i.globalTokens
  return 0
}

export interface CompactDecisionInput extends CompactThresholdInput {
  /** Tokens que ocupa el contexto ahora */
  ctxTokens: number
  /** Compactaciones automáticas ya hechas desde el último mensaje real del usuario */
  autoCompacts: number
  /** Hay una compactación en vuelo */
  compacting: boolean
  /** La sesión se está cerrando */
  closed: boolean
}

/**
 * ¿Toca compactar automáticamente al cerrar este turno?
 *
 * El tope de MAX_AUTO_COMPACTS es lo que impide el bucle: sin él, la secuencia
 * compact → «continúa» → el agente trabaja → vuelve a cruzar el umbral →
 * compact → … se repetía indefinidamente con la pestaña abierta y sin que el
 * usuario escribiera nada. El contador se reinicia con cada mensaje real.
 */
export function shouldAutoCompact(i: CompactDecisionInput): boolean {
  if (i.compacting || i.closed) return false
  if (i.autoCompacts >= MAX_AUTO_COMPACTS) return false
  const threshold = resolveCompactThreshold(i)
  return threshold > 0 && i.ctxTokens >= threshold
}
