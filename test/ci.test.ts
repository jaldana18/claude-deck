import { describe, expect, it } from 'vitest'
import { normalizeStatus, parseRemote } from '../src/main/ci'

/**
 * De este parseo depende que los widgets de Pipelines y Pull requests
 * consulten el proveedor correcto; si falla, el widget queda mudo.
 */
describe('parseRemote', () => {
  it('reconoce GitHub por https y por ssh', () => {
    expect(parseRemote('https://github.com/jaldana18/claude-deck.git')).toEqual({
      provider: 'github',
      owner: 'jaldana18',
      repo: 'claude-deck'
    })
    expect(parseRemote('git@github.com:jaldana18/claude-deck.git')).toEqual({
      provider: 'github',
      owner: 'jaldana18',
      repo: 'claude-deck'
    })
  })

  it('reconoce Azure DevOps moderno (dev.azure.com) con proyecto y repo', () => {
    expect(
      parseRemote('https://dev.azure.com/eliderar/FacturaElectronica/_git/facturacion-electronica')
    ).toEqual({
      provider: 'azure',
      org: 'eliderar',
      project: 'FacturaElectronica',
      repo: 'facturacion-electronica'
    })
  })

  it('reconoce Azure DevOps con usuario embebido en la URL', () => {
    const r = parseRemote('https://eliderar@dev.azure.com/eliderar/FacturaElectronica/_git/rg')
    expect(r.provider).toBe('azure')
    expect(r.org).toBe('eliderar')
    expect(r.repo).toBe('rg')
  })

  it('reconoce Azure DevOps legado (visualstudio.com)', () => {
    const r = parseRemote('https://eliderar.visualstudio.com/FacturaElectronica/_git/rg')
    expect(r).toEqual({
      provider: 'azure',
      org: 'eliderar',
      project: 'FacturaElectronica',
      repo: 'rg'
    })
  })

  it('reconoce Bitbucket', () => {
    expect(parseRemote('git@bitbucket.org:equipo/repo.git')).toEqual({
      provider: 'bitbucket',
      owner: 'equipo',
      repo: 'repo'
    })
  })

  it('devuelve «none» para remotes desconocidos o vacíos', () => {
    expect(parseRemote('https://gitlab.com/x/y.git').provider).toBe('none')
    expect(parseRemote('').provider).toBe('none')
    expect(parseRemote('   ').provider).toBe('none')
  })

  it('tolera el salto de línea que devuelve git remote get-url', () => {
    expect(parseRemote('https://github.com/a/b.git\n').repo).toBe('b')
  })
})

describe('normalizeStatus', () => {
  it('mapea los estados de GitHub Actions', () => {
    expect(normalizeStatus('completed', 'success')).toBe('success')
    expect(normalizeStatus('completed', 'failure')).toBe('failed')
    expect(normalizeStatus('in_progress', null)).toBe('running')
    expect(normalizeStatus('queued', null)).toBe('running')
  })

  it('mapea los estados de Azure Pipelines', () => {
    expect(normalizeStatus('completed', 'succeeded')).toBe('success')
    expect(normalizeStatus('inProgress', undefined)).toBe('running')
    expect(normalizeStatus('completed', 'partiallySucceeded')).toBe('partial')
    expect(normalizeStatus('completed', 'canceled')).toBe('canceled')
  })

  it('no marca como éxito lo que sigue corriendo', () => {
    // caso peligroso: un build en curso NO debe pintarse verde
    expect(normalizeStatus('inProgress', 'succeeded')).toBe('running')
  })

  it('cae en unknown si no hay datos', () => {
    expect(normalizeStatus(undefined, undefined)).toBe('unknown')
  })
})
