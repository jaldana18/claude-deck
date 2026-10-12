import type { ModelOption } from '../../../../shared/types'
import {
  MODEL_ALIASES,
  MODEL_CATALOG,
  MODEL_FAMILY_LABEL,
  labelFor,
  type ModelFamily
} from '../../../../shared/models'

/** Respaldo si el SDK aún no reporta los modelos (los alias siempre funcionan) */
const FALLBACK_MODELS: ModelOption[] = MODEL_ALIASES.filter((a) => a.value !== 'default').map(
  (a) => ({ value: a.value, displayName: a.label })
)

const FAMILIAS: ModelFamily[] = ['fable', 'opus', 'sonnet', 'haiku']

export interface ModelGroup {
  label: string
  items: { value: string; label: string; hint?: string }[]
}

/**
 * Grupos de modelos para los menús.
 *
 * El SDK solo reporta alias, que apuntan a lo que Anthropic considere vigente:
 * cómodo, pero impide fijar una versión. Arriba van los alias —mostrando a
 * qué resuelven hoy— y debajo las versiones concretas, agrupadas por familia.
 */
export function modelGroups(models: ModelOption[]): ModelGroup[] {
  const alias = models.length > 0 ? models : FALLBACK_MODELS
  const groups: ModelGroup[] = [
    {
      label: 'Alias · siguen al modelo vigente',
      items: alias.map((m) => ({
        value: m.value,
        label: m.displayName,
        hint: m.resolvedModel ? labelFor(m.resolvedModel) : undefined
      }))
    }
  ]
  for (const f of FAMILIAS) {
    const items = MODEL_CATALOG.filter((c) => c.family === f)
    if (items.length === 0) continue
    groups.push({
      label: `${MODEL_FAMILY_LABEL[f]} · versión fija`,
      items: items.map((c) => ({
        value: c.id,
        label: c.label,
        hint: `${c.context >= 1_000_000 ? '1M' : '200K'}${c.deprecated ? ' · se retira' : ''}`
      }))
    })
  }
  return groups
}

/** ¿El id está en alguna de las listas, o el usuario lo escribió a mano? */
export function esConocido(model: string, models: ModelOption[]): boolean {
  if (!model) return true
  const alias = models.length > 0 ? models : FALLBACK_MODELS
  return alias.some((m) => m.value === model) || MODEL_CATALOG.some((c) => c.id === model)
}

/** Etiqueta corta para el chip del composer */
export function modelChipLabel(model: string, autoModel: string): string {
  if (!model) return autoModel ? `auto · ${labelFor(autoModel)}` : 'auto'
  return labelFor(model)
}
