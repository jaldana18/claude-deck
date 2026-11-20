import { describe, expect, it } from 'vitest'
import { MAX_CHARS_VISTA, recortarParaVista } from '../src/shared/recorte'

describe('recortarParaVista', () => {
  it('deja intacto un mensaje normal', () => {
    expect(recortarParaVista('fallo el typecheck 1227')).toBe('fallo el typecheck 1227')
  })

  it('recorta un log enorme conservando principio y final', () => {
    const log = 'INICIO' + 'x'.repeat(2_600_000) + 'ERROR FINAL'
    const vista = recortarParaVista(log)
    expect(vista.length).toBeLessThan(MAX_CHARS_VISTA)
    expect(vista.startsWith('INICIO')).toBe(true)
    expect(vista.endsWith('ERROR FINAL')).toBe(true)
    expect(vista).toContain('omitidos en la vista')
  })
})
