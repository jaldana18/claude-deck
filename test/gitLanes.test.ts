import { describe, expect, it } from 'vitest'
import { layoutLanes } from '../src/main/gitPanel'
import type { GitCommit } from '../src/shared/types'

type Input = Omit<GitCommit, 'lane' | 'mergeLanes' | 'activeAfter' | 'closes'>

const c = (hash: string, parents: string[]): Input => ({
  hash,
  parents,
  author: 'a',
  date: '2026-01-01',
  refs: [],
  subject: hash
})

/** El grafo del widget de Git: carriles, merges y confluencias */
describe('layoutLanes', () => {
  it('pone una historia lineal en un solo carril', () => {
    const rows = layoutLanes([c('a', ['b']), c('b', ['c']), c('c', [])])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows[0].mergeLanes).toEqual([])
    // tras el último commit (sin padres) no queda ningún carril activo
    expect(rows[2].activeAfter).toEqual([])
  })

  it('un merge abre un carril extra para el segundo padre', () => {
    const rows = layoutLanes([c('m', ['a', 'f']), c('a', ['base']), c('f', ['base'])])
    expect(rows[0].lane).toBe(0)
    expect(rows[0].mergeLanes).toHaveLength(1)
    expect(rows[0].mergeLanes[0]).toBeGreaterThan(0)
    // mientras ambas ramas esperan, hay dos carriles vivos
    expect(rows[0].activeAfter.length).toBe(2)
  })

  it('marca la confluencia cuando dos carriles esperan el mismo commit', () => {
    const rows = layoutLanes([c('m', ['a', 'f']), c('a', ['base']), c('f', ['base']), c('base', [])])
    const baseRow = rows[3]
    // la rama secundaria se cierra al llegar al ancestro común
    expect(baseRow.closes.length).toBeGreaterThan(0)
    expect(baseRow.activeAfter).toEqual([])
  })

  it('no repite carril entre commits vivos simultáneos', () => {
    const rows = layoutLanes([c('m', ['a', 'f']), c('a', ['x']), c('f', ['y'])])
    expect(rows[1].lane).not.toBe(rows[2].lane)
  })

  it('devuelve una fila por commit conservando el orden', () => {
    const rows = layoutLanes([c('a', ['b']), c('b', [])])
    expect(rows.map((r) => r.hash)).toEqual(['a', 'b'])
  })
})
