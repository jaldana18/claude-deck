import { describe, expect, it } from 'vitest'
import { CLIENTE_LOCAL, Ownership } from '../src/main/ownership'
import type { Emitter } from '../src/main/bus'

function montar(): { own: Ownership; eventos: { tabId: string; owner: unknown }[] } {
  const eventos: { tabId: string; owner: unknown }[] = []
  const bus: Emitter = {
    send: (channel, payload) => {
      if (channel === 'chat:owner') eventos.push(payload as { tabId: string; owner: unknown })
      return 1
    }
  }
  return { own: new Ownership(bus), eventos }
}

describe('Ownership', () => {
  it('con el PC como único cliente nunca estorba', () => {
    const { own } = montar()
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(true)
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(true)
    expect(own.owner('tab-1')?.clientId).toBe(CLIENTE_LOCAL)
  })

  it('la propiedad se toma actuando, sin pedirla', () => {
    const { own, eventos } = montar()
    own.register('movil', 'Pixel')
    expect(own.puedeActuar('tab-1', 'movil')).toBe(true)
    expect(own.owner('tab-1')).toMatchObject({ clientId: 'movil', label: 'Pixel', connected: true })
    expect(eventos).toHaveLength(1)
  })

  it('el segundo dispositivo no puede enviar mientras el dueño siga conectado', () => {
    const { own } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', CLIENTE_LOCAL)

    expect(own.puedeActuar('tab-1', 'movil')).toBe(false)
    // y no le roba el control al intentarlo
    expect(own.owner('tab-1')?.clientId).toBe(CLIENTE_LOCAL)
  })

  it('el relevo es inmediato y se anuncia', () => {
    const { own, eventos } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', CLIENTE_LOCAL)
    eventos.length = 0

    expect(own.claim('tab-1', 'movil')).toMatchObject({ clientId: 'movil' })
    expect(eventos).toEqual([{ tabId: 'tab-1', owner: expect.objectContaining({ clientId: 'movil' }) }])
    expect(own.puedeActuar('tab-1', 'movil')).toBe(true)
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(false)
  })

  it('reclamar lo que ya es tuyo no emite ruido', () => {
    const { own, eventos } = montar()
    own.claim('tab-1', CLIENTE_LOCAL)
    eventos.length = 0
    own.claim('tab-1', CLIENTE_LOCAL)
    expect(eventos).toEqual([])
  })

  it('cada conversación tiene su propio dueño', () => {
    const { own } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', CLIENTE_LOCAL)
    own.puedeActuar('tab-2', 'movil')

    expect(own.puedeActuar('tab-2', 'movil')).toBe(true)
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(true)
    expect(own.list()).toHaveLength(2)
  })

  it('un dueño que se desconecta suelta lo suyo y no bloquea al que queda', () => {
    const { own, eventos } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', 'movil')
    eventos.length = 0

    own.unregister('movil')
    expect(own.owner('tab-1')).toBeNull()
    expect(eventos).toEqual([{ tabId: 'tab-1', owner: null }])
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(true)
  })

  it('un dueño desconectado sin aviso tampoco bloquea', () => {
    const { own } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', 'movil')
    // el móvil desaparece por un túnel caído: el registro se pierde, el dueño no
    own.unregister('movil')
    own.puedeActuar('tab-1', CLIENTE_LOCAL)
    own.register('movil', 'Pixel')

    expect(own.puedeActuar('tab-1', 'movil')).toBe(false)
    expect(own.claim('tab-1', 'movil').clientId).toBe('movil')
  })

  it('cerrar la pestaña borra su propiedad', () => {
    const { own } = montar()
    own.register('movil', 'Pixel')
    own.puedeActuar('tab-1', 'movil')
    own.forget('tab-1')
    expect(own.owner('tab-1')).toBeNull()
    expect(own.puedeActuar('tab-1', CLIENTE_LOCAL)).toBe(true)
  })
})
