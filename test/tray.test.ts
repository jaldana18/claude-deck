import { describe, expect, it } from 'vitest'
import { trayStatusLabel, trayTooltip } from '../src/shared/tray'

describe('trayTooltip', () => {
  it('avisa cuando no queda nada corriendo', () => {
    expect(trayTooltip({ chats: 0, terminals: 0 })).toBe('Claude Deck — sin sesiones activas')
  })

  it('usa singular con una sola pestaña', () => {
    expect(trayTooltip({ chats: 1, terminals: 0 })).toBe('Claude Deck — 1 chat en segundo plano')
    expect(trayTooltip({ chats: 0, terminals: 1 })).toBe(
      'Claude Deck — 1 terminal en segundo plano'
    )
  })

  it('omite la categoría vacía en vez de escribir «0 terminales»', () => {
    expect(trayTooltip({ chats: 3, terminals: 0 })).toBe('Claude Deck — 3 chats en segundo plano')
  })

  it('junta ambas categorías', () => {
    expect(trayTooltip({ chats: 2, terminals: 4 })).toBe(
      'Claude Deck — 2 chats y 4 terminales en segundo plano'
    )
  })

  it('cabe en el tooltip de Windows (127 caracteres)', () => {
    expect(trayTooltip({ chats: 999, terminals: 999 }).length).toBeLessThanOrEqual(127)
  })
})

describe('trayStatusLabel', () => {
  it('suma chats y terminales', () => {
    expect(trayStatusLabel({ chats: 2, terminals: 3 })).toBe('5 sesiones activas')
    expect(trayStatusLabel({ chats: 1, terminals: 0 })).toBe('1 sesión activa')
    expect(trayStatusLabel({ chats: 0, terminals: 0 })).toBe('Sin sesiones activas')
  })
})
