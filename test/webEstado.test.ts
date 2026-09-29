import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot, TabState } from '../src/shared/types'

vi.mock('../src/web/api', () => ({
  sesion: () => ({ token: 't', clientId: 'c1' }),
  pedirPestanas: vi.fn(),
  pedirSnapshots: vi.fn(),
  pedirDuenos: vi.fn()
}))

import * as api from '../src/web/api'
import { tienda, VERSION } from '../src/web/estado'

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

describe('versión del PC', () => {
  it('la misma versión no pide nada', () => {
    tienda.versionPC = VERSION
    expect(tienda.versionNueva).toBeNull()
  })

  it('otra versión es una actualización pendiente', () => {
    tienda.versionPC = '99.0.0'
    expect(tienda.versionNueva).toBe('99.0.0')
  })

  // Un PC anterior a la 0.33.2 no manda versión: callar es mejor que anunciar
  // una actualización que no se sabe si existe.
  it('sin versión del PC no se anuncia nada', () => {
    tienda.versionPC = null
    expect(tienda.versionNueva).toBeNull()
  })
})
