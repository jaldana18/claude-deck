import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot, TabState } from '../src/shared/types'

vi.mock('../src/web/api', () => ({
  sesion: () => ({ token: 't', clientId: 'c1' }),
  pedirPestanas: vi.fn(),
  pedirSnapshots: vi.fn(),
  pedirDuenos: vi.fn()
}))

import * as api from '../src/web/api'
import { tienda } from '../src/web/estado'

function tab(id: string): TabState {
  return { id, title: id, cwd: 'C:\\proyectos', mode: 'chat' } as TabState
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => {
    fn(0)
    return 0
  })
  tienda.lista = []
  vi.mocked(api.pedirPestanas).mockResolvedValue({ tabs: [tab('t1'), tab('t2')] } as never)
  vi.mocked(api.pedirSnapshots).mockResolvedValue([])
  vi.mocked(api.pedirDuenos).mockResolvedValue([])
})

describe('cargarBase', () => {
  it('trae las conversaciones abiertas en el PC', async () => {
    vi.mocked(api.pedirSnapshots).mockResolvedValue([{ tabId: 't2', busy: true } as SessionSnapshot])
    await tienda.cargarBase()

    expect(tienda.lista.map((e) => e.tab.id)).toEqual(['t1', 't2'])
    expect(tienda.entrada('t2')?.snapshot?.busy).toBe(true)
  })

  // Es lo único que siempre se puede mostrar: sin la lista, la app se queda en
  // «sin datos del PC» aunque el PC esté contestando perfectamente.
  it('la lista se pinta aunque fallen los snapshots o los dueños', async () => {
    vi.mocked(api.pedirSnapshots).mockRejectedValue(new Error('caído'))
    vi.mocked(api.pedirDuenos).mockRejectedValue(new Error('caído'))
    await tienda.cargarBase()

    expect(tienda.lista.map((e) => e.tab.id)).toEqual(['t1', 't2'])
  })

  it('si lo que falla son las pestañas, el fallo sube: hay que avisar', async () => {
    vi.mocked(api.pedirPestanas).mockRejectedValue(new Error('401'))
    await expect(tienda.cargarBase()).rejects.toThrow('401')
  })
})
