import { describe, expect, it } from 'vitest'
import { PANE_COUNT, paneIdsFor, paneTabId } from '../src/shared/types'

/**
 * El pane principal comparte id con la pestaña: de eso depende que los
 * scrollbacks guardados antes de los splits sigan restaurándose (resurrección).
 */
describe('ids de paneles', () => {
  it('el panel principal usa el propio tabId (retrocompatible)', () => {
    expect(paneIdsFor('tab-1', 'single')).toEqual(['tab-1'])
    expect(paneIdsFor('tab-1', undefined)).toEqual(['tab-1'])
  })

  it('los splits derivan ids estables', () => {
    expect(paneIdsFor('tab-1', 'cols')).toEqual(['tab-1', 'tab-1#2'])
    expect(paneIdsFor('tab-1', 'grid')).toEqual(['tab-1', 'tab-1#2', 'tab-1#3', 'tab-1#4'])
  })

  it('la cantidad de paneles coincide con el layout', () => {
    expect(paneIdsFor('t', 'rows')).toHaveLength(PANE_COUNT.rows)
    expect(paneIdsFor('t', 'grid')).toHaveLength(PANE_COUNT.grid)
  })

  it('paneTabId revierte cualquier id de panel a su pestaña', () => {
    expect(paneTabId('tab-1')).toBe('tab-1')
    expect(paneTabId('tab-1#4')).toBe('tab-1')
  })

  it('ida y vuelta: todo pane pertenece a su pestaña', () => {
    for (const id of paneIdsFor('abc-123', 'grid')) {
      expect(paneTabId(id)).toBe('abc-123')
    }
  })
})
