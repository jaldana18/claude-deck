import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from '../src/shared/version'

/**
 * El updater decide con esto si ofrece una actualización. Un fallo aquí
 * significa o bien que el equipo no recibe versiones nuevas, o bien que se
 * les ofrece una vieja como si fuera nueva.
 */
describe('comparación de versiones del updater', () => {
  it('detecta versión mayor en cada componente', () => {
    expect(compareVersions(parseVersion('0.19.0'), parseVersion('0.18.2'))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('1.0.0'), parseVersion('0.99.99'))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('0.18.3'), parseVersion('0.18.2'))).toBeGreaterThan(0)
  })

  it('no confunde el orden lexicográfico con el numérico', () => {
    // '0.9.0' > '0.10.0' como texto, pero 0.10.0 es la versión mayor
    expect(compareVersions(parseVersion('0.10.0'), parseVersion('0.9.0'))).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('0.2.0'), parseVersion('0.19.0'))).toBeLessThan(0)
  })

  it('considera iguales las versiones idénticas (no ofrece reinstalar)', () => {
    expect(compareVersions(parseVersion('0.19.0'), parseVersion('0.19.0'))).toBe(0)
  })

  it('tolera versiones incompletas o con basura', () => {
    expect(compareVersions(parseVersion('1'), parseVersion('1.0.0'))).toBe(0)
    expect(compareVersions(parseVersion('v2.0.0'.replace(/^v/, '')), parseVersion('1.9.9'))).toBeGreaterThan(0)
  })
})
