import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El bus reparte los eventos IPC del chat a la pestaña destinataria usando UN
 * solo listener por canal. Sin él, con N pestañas abiertas cada evento del
 * proceso principal ejecutaba 19×N callbacks (la app se traba con varias
 * sesiones abiertas). Estos tests fijan ese contrato.
 */

type Cb = (p: { tabId: string; text?: string }) => void

/** Puente falso: cuenta cuántos listeners reales se registran por canal */
function fakeDeck(): {
  deck: Record<string, unknown>
  emit: (channel: string, payload: { tabId: string; text?: string }) => void
  registered: () => number
} {
  const listeners = new Map<string, Set<Cb>>()
  const make =
    (channel: string) =>
    (cb: Cb): (() => void) => {
      const set = listeners.get(channel) ?? new Set<Cb>()
      set.add(cb)
      listeners.set(channel, set)
      return () => set.delete(cb)
    }
  return {
    deck: {
      onChatStreamStart: make('streamStart'),
      onChatDelta: make('delta'),
      onChatMessage: make('message'),
      onChatToolResult: make('toolResult'),
      onChatResult: make('result'),
      onChatError: make('error'),
      onChatPermissionRequest: make('permissionRequest'),
      onChatPermissionCancel: make('permissionCancel'),
      onChatCommands: make('commands'),
      onChatModels: make('models'),
      onChatInitModel: make('initModel'),
      onChatQuestion: make('question'),
      onChatQuestionCancel: make('questionCancel'),
      onChatTodos: make('todos'),
      onChatAutoCompact: make('autoCompact'),
      onChatAutoContinue: make('autoContinue'),
      onChatSubagentBatch: make('subagentBatch'),
      onChatAgentDone: make('agentDone'),
      onChatSwitched: make('switched')
    },
    emit: (channel, payload) => listeners.get(channel)?.forEach((cb) => cb(payload)),
    registered: () => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  }
}

let bus: typeof import('../src/renderer/src/chatBus')
let harness: ReturnType<typeof fakeDeck>

beforeEach(async () => {
  harness = fakeDeck()
  // @ts-expect-error entorno de prueba: se simula el puente del preload
  globalThis.window = { deck: harness.deck }
  vi.resetModules()
  bus = await import('../src/renderer/src/chatBus')
})

describe('bus de eventos del chat', () => {
  it('entrega el evento solo a la pestaña destinataria', () => {
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribeChat('tab-a', { delta: a })
    bus.subscribeChat('tab-b', { delta: b })

    harness.emit('delta', { tabId: 'tab-b', text: 'hola' })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith({ tabId: 'tab-b', text: 'hola' })
  })

  it('registra UN listener por canal aunque haya muchas pestañas', () => {
    for (let i = 0; i < 10; i++) bus.subscribeChat(`tab-${i}`, { delta: vi.fn() })
    expect(harness.registered()).toBe(1)
  })

  it('deja de entregar tras darse de baja', () => {
    const h = vi.fn()
    const off = bus.subscribeChat('tab-a', { delta: h })
    off()
    harness.emit('delta', { tabId: 'tab-a' })
    expect(h).not.toHaveBeenCalled()
  })

  it('libera el listener del puente cuando el canal se queda vacío', () => {
    const off1 = bus.subscribeChat('tab-a', { delta: vi.fn() })
    const off2 = bus.subscribeChat('tab-b', { delta: vi.fn() })
    off1()
    expect(harness.registered()).toBe(1)
    off2()
    expect(harness.registered()).toBe(0)
  })

  it('la baja de una pestaña no afecta a las demás', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = bus.subscribeChat('tab-a', { delta: a })
    bus.subscribeChat('tab-b', { delta: b })
    offA()
    harness.emit('delta', { tabId: 'tab-b' })
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('ignora payloads sin tabId sin romper el reparto', () => {
    const h = vi.fn()
    bus.subscribeChat('tab-a', { delta: h })
    // @ts-expect-error payload inválido a propósito
    harness.emit('delta', {})
    expect(h).not.toHaveBeenCalled()
  })
})
