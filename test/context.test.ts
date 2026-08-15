import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_WINDOW,
  MAX_AUTO_COMPACTS,
  contextWindowFor,
  resolveCompactThreshold,
  shouldAutoCompact
} from '../src/shared/context'

describe('contextWindowFor', () => {
  it('reconoce el sufijo [1m] explícito', () => {
    expect(contextWindowFor('claude-opus-5[1m]')).toBe(1_000_000)
    expect(contextWindowFor('claude-sonnet-4-6[1M]')).toBe(1_000_000)
  })

  it('da 1M a los modelos actuales SIN sufijo (el bug que se arregla)', () => {
    // antes todos estos caían en 200k y disparaban el auto-compact con el 80%
    // de la ventana todavía libre
    expect(contextWindowFor('claude-opus-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-opus-4-8')).toBe(1_000_000)
    expect(contextWindowFor('claude-opus-4-7')).toBe(1_000_000)
    expect(contextWindowFor('claude-opus-4-6')).toBe(1_000_000)
    expect(contextWindowFor('claude-sonnet-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-sonnet-4-6')).toBe(1_000_000)
    expect(contextWindowFor('claude-fable-5')).toBe(1_000_000)
  })

  it('mantiene 200k donde de verdad son 200k', () => {
    expect(contextWindowFor('claude-haiku-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(contextWindowFor('claude-haiku-4-5-20251001')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(contextWindowFor('claude-opus-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(contextWindowFor('claude-sonnet-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('resuelve los alias sin versión y cae a 200k si no reconoce nada', () => {
    expect(contextWindowFor('opus')).toBe(1_000_000)
    expect(contextWindowFor('sonnet')).toBe(1_000_000)
    expect(contextWindowFor(undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(contextWindowFor('modelo-inventado')).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})

describe('resolveCompactThreshold', () => {
  const w = 1_000_000

  it('usa el global cuando la pestaña no define nada', () => {
    expect(resolveCompactThreshold({ window: w, globalTokens: 150_000 })).toBe(150_000)
  })

  it('el absoluto de la pestaña gana sobre el global', () => {
    expect(
      resolveCompactThreshold({ window: w, globalTokens: 150_000, tabTokens: 300_000 })
    ).toBe(300_000)
  })

  it('tabTokens = 0 es un off explícito, no un «sin definir»', () => {
    expect(resolveCompactThreshold({ window: w, globalTokens: 150_000, tabTokens: 0 })).toBe(0)
  })

  it('traduce el modo antiguo en % contra la ventana real', () => {
    expect(resolveCompactThreshold({ window: w, tabPct: 80 })).toBe(800_000)
    expect(resolveCompactThreshold({ window: 200_000, tabPct: 80 })).toBe(160_000)
  })

  it('devuelve 0 (off) si no hay nada configurado', () => {
    expect(resolveCompactThreshold({ window: w })).toBe(0)
  })
})

describe('shouldAutoCompact', () => {
  const base = {
    window: 1_000_000,
    globalTokens: 150_000,
    ctxTokens: 200_000,
    autoCompacts: 0,
    compacting: false,
    closed: false
  }

  it('compacta al superar el umbral', () => {
    expect(shouldAutoCompact(base)).toBe(true)
  })

  it('no compacta por debajo del umbral', () => {
    expect(shouldAutoCompact({ ...base, ctxTokens: 100_000 })).toBe(false)
  })

  it('no compacta si ya hay una compactación en vuelo', () => {
    expect(shouldAutoCompact({ ...base, compacting: true })).toBe(false)
  })

  it('no compacta con la sesión cerrada', () => {
    expect(shouldAutoCompact({ ...base, closed: true })).toBe(false)
  })

  it('corta el bucle al llegar al tope de compactaciones encadenadas', () => {
    // este es el caso que provocaba compact → «continúa» → compact → … infinito
    expect(shouldAutoCompact({ ...base, autoCompacts: MAX_AUTO_COMPACTS - 1 })).toBe(true)
    expect(shouldAutoCompact({ ...base, autoCompacts: MAX_AUTO_COMPACTS })).toBe(false)
    expect(shouldAutoCompact({ ...base, autoCompacts: MAX_AUTO_COMPACTS + 5 })).toBe(false)
  })

  it('sin umbral configurado nunca compacta', () => {
    expect(shouldAutoCompact({ ...base, globalTokens: 0 })).toBe(false)
  })

  it('respeta el off explícito de la pestaña aunque el global esté activo', () => {
    expect(shouldAutoCompact({ ...base, tabTokens: 0 })).toBe(false)
  })
})
