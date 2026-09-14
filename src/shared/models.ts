/**
 * Catálogo de modelos para el selector.
 *
 * El SDK solo reporta filas de *alias* (`opus`, `sonnet`, `haiku`, `fable`,
 * `default`): cinco entradas que apuntan a lo que Anthropic considere vigente
 * hoy. Eso es cómodo pero impide fijar una versión, que es justo lo que hace
 * falta cuando una versión concreta se degrada o cuando quieres reproducir un
 * resultado semanas después. Este catálogo añade las versiones explícitas.
 *
 * El CLI acepta el id crudo, así que la app no traduce nada: el string viaja
 * tal cual hasta `query({ options: { model } })`. Por eso el selector admite
 * además un id escrito a mano — si Anthropic publica un modelo nuevo antes de
 * que este archivo se actualice, sigue siendo utilizable sin tocar código.
 */

/** Familias en el orden en que se muestran */
export type ModelFamily = 'fable' | 'opus' | 'sonnet' | 'haiku'

export interface CatalogModel {
  /** id exacto que se le pasa al CLI */
  id: string
  /** etiqueta corta para el desplegable */
  label: string
  family: ModelFamily
  /** ventana de contexto en tokens, para mostrarla junto al nombre */
  context: number
  /** los que Anthropic marca como retirándose: se muestran al final y avisados */
  deprecated?: boolean
}

export const MODEL_FAMILY_LABEL: Record<ModelFamily, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku'
}

const M = 1_000_000
const K200 = 200_000

/**
 * Versiones fijables. Se listan de más nueva a más antigua dentro de cada
 * familia. Las variantes `[1m]` son el mismo modelo con la ventana de 1M
 * activada explícitamente; sin el sufijo, el CLI usa la ventana que traiga por
 * defecto la cuenta.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  { id: 'claude-fable-5', label: 'Fable 5', family: 'fable', context: M },

  { id: 'claude-opus-5', label: 'Opus 5', family: 'opus', context: M },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'opus', context: M },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'opus', context: M },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'opus', context: M },
  { id: 'claude-opus-4-5', label: 'Opus 4.5', family: 'opus', context: K200 },
  { id: 'claude-opus-4-1', label: 'Opus 4.1', family: 'opus', context: K200, deprecated: true },

  { id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'sonnet', context: M },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'sonnet', context: M },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', family: 'sonnet', context: K200 },

  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', family: 'haiku', context: K200 }
]

/** Alias que el CLI entiende y que el SDK no siempre devuelve en su lista */
export const MODEL_ALIASES: { value: string; label: string; nota: string }[] = [
  { value: 'default', label: 'Default', nota: 'el que Anthropic recomiende' },
  { value: 'opus', label: 'Opus', nota: 'último Opus' },
  { value: 'sonnet', label: 'Sonnet', nota: 'último Sonnet' },
  { value: 'haiku', label: 'Haiku', nota: 'último Haiku' },
  { value: 'fable', label: 'Fable', nota: 'último Fable' },
  { value: 'opusplan', label: 'Opus para planear', nota: 'Opus al planificar, Sonnet al ejecutar' }
]

/** Familia a la que pertenece un id o alias, para agrupar alertas por modelo */
export function familyOf(model?: string): ModelFamily | undefined {
  if (!model) return undefined
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  return undefined
}

/** ¿El id trae versión explícita, o es un alias que se mueve solo? */
export function isPinned(model?: string): boolean {
  if (!model) return false
  return /\d/.test(model.replace(/\[1m\]$/, ''))
}

/** Etiqueta legible para un id cualquiera, venga o no del catálogo */
export function labelFor(model?: string): string {
  if (!model) return 'auto'
  const base = model.replace(/\[1m\]$/, '')
  const hit = MODEL_CATALOG.find((c) => c.id === base)
  const sufijo = model.endsWith('[1m]') ? ' · 1M' : ''
  if (hit) return hit.label + sufijo
  const alias = MODEL_ALIASES.find((a) => a.value === base)
  if (alias) return alias.label + sufijo
  return model.replace(/^claude-/, '')
}
