import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG, familyOf, isPinned, labelFor } from '../src/shared/models'

describe('familyOf', () => {
  it('resuelve alias e ids con versión a la misma familia', () => {
    expect(familyOf('opus')).toBe('opus')
    expect(familyOf('claude-opus-4-6')).toBe('opus')
    expect(familyOf('claude-sonnet-5')).toBe('sonnet')
    expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku')
  })

  it('trata mythos como fable: mismo modelo, distinto id', () => {
    expect(familyOf('claude-mythos-5')).toBe('fable')
    expect(familyOf('claude-fable-5[1m]')).toBe('fable')
  })

  it('no inventa familia para lo que no reconoce', () => {
    expect(familyOf(undefined)).toBeUndefined()
    expect(familyOf('default')).toBeUndefined()
    expect(familyOf('gpt-5')).toBeUndefined()
  })
})

describe('isPinned', () => {
  it('distingue un alias móvil de una versión fija', () => {
    expect(isPinned('opus')).toBe(false)
    expect(isPinned('sonnet')).toBe(false)
    expect(isPinned('default')).toBe(false)
    expect(isPinned('claude-opus-4-8')).toBe(true)
    expect(isPinned('claude-haiku-4-5-20251001')).toBe(true)
  })

  it('el sufijo [1m] no convierte un alias en versión fija', () => {
    // 'opus[1m]' sigue moviéndose con Anthropic; solo fija la ventana
    expect(isPinned('opus[1m]')).toBe(false)
    expect(isPinned('claude-opus-5[1m]')).toBe(true)
  })

  it('sin modelo no hay nada fijado', () => {
    expect(isPinned(undefined)).toBe(false)
    expect(isPinned('')).toBe(false)
  })
})

describe('labelFor', () => {
  it('usa la etiqueta del catálogo y marca la ventana de 1M', () => {
    expect(labelFor('claude-opus-4-6')).toBe('Opus 4.6')
    expect(labelFor('claude-fable-5[1m]')).toBe('Fable 5 · 1M')
  })

  it('degrada con elegancia ante un id que no conoce', () => {
    // Si Anthropic publica un modelo antes de que se actualice el catálogo,
    // el selector debe seguir mostrando algo legible en vez de romperse.
    expect(labelFor('claude-opus-9-9')).toBe('opus-9-9')
    expect(labelFor(undefined)).toBe('auto')
  })
})

describe('MODEL_CATALOG', () => {
  it('no tiene ids repetidos', () => {
    const ids = MODEL_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada entrada declara la familia que su id implica', () => {
    for (const c of MODEL_CATALOG) expect(familyOf(c.id)).toBe(c.family)
  })
})
