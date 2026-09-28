import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Emitter } from '../src/main/bus'
import type { TabState } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'deck-store-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { Store } = await import('../src/main/store')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

let eventos: [string, unknown][]
let store: InstanceType<typeof Store>

const bus: Emitter = {
  send: (channel, payload) => {
    eventos.push([channel, payload])
    return 1
  }
}

function pestana(id: string): TabState {
  return { id, title: 'chat', cwd: 'C:\\proyecto', mode: 'chat' } as TabState
}

beforeEach(() => {
  eventos = []
  store = new Store()
  for (const t of [...store.tabs]) store.removeTab(t.id)
  store.setEmitter(bus)
  eventos = []
})

describe('anuncio del estado de pestañas', () => {
  it('un cambio de modelo se anuncia con el parche', () => {
    store.addTab(pestana('tab-1'))
    eventos.length = 0
    store.updateTab('tab-1', { model: 'claude-opus-5-5' })

    expect(eventos).toEqual([['tab:state', { tabId: 'tab-1', patch: { model: 'claude-opus-5-5' } }]])
  })

  it('la salud no se anuncia por aquí: tiene su propio canal y llega en cada turno', () => {
    store.addTab(pestana('tab-1'))
    eventos.length = 0
    store.updateTab('tab-1', { lastHealth: { tabId: 'tab-1', contextTokens: 10 } } as Partial<TabState>)

    expect(eventos).toEqual([])
  })

  it('un parche mixto anuncia solo lo que no tiene canal propio', () => {
    store.addTab(pestana('tab-1'))
    eventos.length = 0
    store.updateTab('tab-1', {
      claudeSessionId: 'sdk-1',
      lastHealth: { tabId: 'tab-1', contextTokens: 10 }
    } as Partial<TabState>)

    expect(eventos).toEqual([['tab:state', { tabId: 'tab-1', patch: { claudeSessionId: 'sdk-1' } }]])
  })

  it('una pestaña que no existe no anuncia nada', () => {
    store.updateTab('fantasma', { model: 'x' })
    expect(eventos).toEqual([])
  })

  it('abrir y cerrar pestañas manda la lista completa', () => {
    store.addTab(pestana('tab-1'))
    expect(eventos).toHaveLength(1)
    expect(eventos[0][0]).toBe('tab:list')

    store.addTab(pestana('tab-2'))
    const lista = (eventos.at(-1)![1] as { tabs: TabState[] }).tabs.map((t) => t.id)
    expect(lista).toEqual(['tab-1', 'tab-2'])

    store.removeTab('tab-1')
    expect(eventos.at(-1)![0]).toBe('tab:list')
    expect((eventos.at(-1)![1] as { tabs: TabState[] }).tabs.map((t) => t.id)).toEqual(['tab-2'])
  })

  it('la pestaña activa no se anuncia: cada dispositivo mira lo que quiere', () => {
    store.addTab(pestana('tab-1'))
    eventos.length = 0
    store.setActiveTab('tab-1')
    expect(eventos).toEqual([])
  })
})
