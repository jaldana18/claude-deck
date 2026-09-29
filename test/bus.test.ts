import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { Bus, type BusEvent } from '../src/main/bus'

/** Ventana de Electron falsa: solo necesitamos `isDestroyed` y `webContents.send`. */
function ventana(destruida = false): { win: BrowserWindow; enviados: [string, unknown][] } {
  const enviados: [string, unknown][] = []
  const win = {
    isDestroyed: () => destruida,
    webContents: { send: (c: string, p: unknown) => enviados.push([c, p]) }
  } as unknown as BrowserWindow
  return { win, enviados }
}

describe('Bus', () => {
  it('entrega a la ventana y a los sinks, y cuenta los destinos', () => {
    const { win, enviados } = ventana()
    const bus = new Bus(() => win)
    const vistos: BusEvent[] = []
    bus.subscribe((ev) => vistos.push(ev))

    expect(bus.send('chat:delta', { texto: 'hola' })).toBe(2)
    expect(enviados).toEqual([['chat:delta', { texto: 'hola' }]])
    expect(vistos).toHaveLength(1)
    expect(vistos[0]).toMatchObject({ seq: 1, channel: 'chat:delta' })
  })

  it('devuelve 0 cuando nadie escucha: es la señal de reintento del updater', () => {
    expect(new Bus(() => null).send('update:available', {})).toBe(0)
  })

  it('no entrega a una ventana destruida', () => {
    const { win, enviados } = ventana(true)
    expect(new Bus(() => win).send('x', 1)).toBe(0)
    expect(enviados).toHaveLength(0)
  })

  it('un sink que lanza no impide la entrega a los demás', () => {
    const bus = new Bus(() => null)
    const bueno = vi.fn()
    bus.subscribe(() => {
      throw new Error('cliente remoto caído')
    })
    bus.subscribe(bueno)

    expect(bus.send('x', 1)).toBe(1)
    expect(bueno).toHaveBeenCalledOnce()
  })

  it('darse de baja deja de recibir', () => {
    const bus = new Bus(() => null)
    const sink = vi.fn()
    const baja = bus.subscribe(sink)
    bus.send('a', 1)
    baja()
    bus.send('b', 2)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('numera los eventos de forma creciente y los sirve desde un punto', () => {
    const bus = new Bus(() => null)
    bus.send('a', 1)
    bus.send('b', 2)
    bus.send('c', 3)

    expect(bus.lastSeq).toBe(3)
    expect(bus.since(1).map((e) => e.channel)).toEqual(['b', 'c'])
    expect(bus.since(3)).toEqual([])
  })

  it('recorta el anillo y avisa del hueco al que se quedó atrás', () => {
    const bus = new Bus(() => null, 10)
    for (let i = 0; i < 40; i++) bus.send('delta', i)

    expect(bus.since(0).length).toBeLessThanOrEqual(15)
    // el que iba por el evento 1 perdió eventos: debe rehidratarse con snapshot
    expect(bus.hasGapSince(1)).toBe(true)
    expect(bus.hasGapSince(bus.lastSeq)).toBe(false)
  })

  it('un observador del main recibe todo pero no cuenta como destinatario', () => {
    const bus = new Bus(() => null)
    const visto: string[] = []
    bus.observe((ev) => visto.push(ev.channel))

    // 0 destinatarios con un observador puesto: es lo que el updater necesita
    // para reintentar el aviso cuando no hay nadie mirando.
    expect(bus.send('update:available', {})).toBe(0)
    expect(visto).toEqual(['update:available'])
  })

  it('un observador que lanza no impide la entrega', () => {
    const { win, enviados } = ventana()
    const bus = new Bus(() => win)
    bus.observe(() => {
      throw new Error('aviso roto')
    })
    expect(bus.send('tab:status', { status: 'done' })).toBe(1)
    expect(enviados).toHaveLength(1)
  })

  it('dejar de observar deja de recibir', () => {
    const bus = new Bus(() => null)
    const obs = vi.fn()
    const baja = bus.observe(obs)
    bus.send('a', 1)
    baja()
    bus.send('b', 2)
    expect(obs).toHaveBeenCalledOnce()
  })

  it('sin recorte no hay hueco', () => {
    const bus = new Bus(() => null, 100)
    bus.send('a', 1)
    bus.send('b', 2)
    expect(bus.hasGapSince(0)).toBe(false)
    expect(bus.hasGapSince(1)).toBe(false)
  })
})
