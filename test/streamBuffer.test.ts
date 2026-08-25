import { describe, expect, it } from 'vitest'
import { appendDelta } from '../src/shared/streamBuffer'

describe('appendDelta', () => {
  it('arranca desde cero cuando no hay nada acumulado', () => {
    expect(appendDelta(null, 'm1', 'hola')).toEqual({ id: 'm1', text: 'hola' })
  })

  it('concatena mientras sea el mismo mensaje', () => {
    const a = appendDelta(null, 'm1', 'hola')
    expect(appendDelta(a, 'm1', ' mundo')).toEqual({ id: 'm1', text: 'hola mundo' })
  })

  it('descarta lo anterior si cambia el mensaje', () => {
    const a = appendDelta(null, 'm1', 'respuesta vieja')
    expect(appendDelta(a, 'm2', 'nueva')).toEqual({ id: 'm2', text: 'nueva' })
  })

  it('no muta el trozo recibido', () => {
    const a = { id: 'm1', text: 'hola' }
    appendDelta(a, 'm1', ' mundo')
    expect(a.text).toBe('hola')
  })

  it('volcar el buffer de una pestaña oculta da el mismo texto que no haberla ocultado', () => {
    const trozos = ['uno ', 'dos ', 'tres ', 'cuatro']
    // ruta visible: delta a delta sobre el estado
    let visible: ReturnType<typeof appendDelta> | null = null
    for (const t of trozos) visible = appendDelta(visible, 'm1', t)

    // ruta oculta: los dos primeros al estado, el resto al buffer, y volcado
    let estado: ReturnType<typeof appendDelta> | null = null
    for (const t of trozos.slice(0, 2)) estado = appendDelta(estado, 'm1', t)
    let buffer: ReturnType<typeof appendDelta> | null = null
    for (const t of trozos.slice(2)) buffer = appendDelta(buffer, 'm1', t)
    const volcado = appendDelta(estado, buffer!.id, buffer!.text)

    expect(volcado).toEqual(visible)
    expect(volcado.text).toBe('uno dos tres cuatro')
  })
})
