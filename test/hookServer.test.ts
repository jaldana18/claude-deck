import { describe, expect, it } from 'vitest'
import { HookServer } from '../src/main/hookServer'
import type { SessionTracker } from '../src/main/sessionTracker'
import type { Emitter } from '../src/main/bus'

/**
 * Las pestañas chat reportan su estado por el SDK; si el hook Stop del proyecto
 * también lo hiciera, cada turno llegaría dos veces como notificación.
 */

function montar(sesiones: Record<string, string>, chats: string[]) {
  const enviados: unknown[] = []
  const reclamos: string[] = []
  const tracker = {
    tabForSession: (id: string) => sesiones[id],
    claimFromHook: (id: string) => {
      reclamos.push(id)
      return sesiones[id] ?? 'terminal-1'
    }
  } as unknown as SessionTracker
  const bus: Emitter = { send: (_c, p) => (enviados.push(p), 1) }
  const server = new HookServer(tracker, bus, (tabId) => chats.includes(tabId))
  const evento = (payload: Record<string, unknown>): void =>
    (server as unknown as { handleEvent: (p: Record<string, unknown>) => void }).handleEvent(payload)
  return { evento, enviados, reclamos }
}

describe('HookServer', () => {
  it('ignora los hooks de una sesión que pertenece a una pestaña chat', () => {
    const { evento, enviados, reclamos } = montar({ 'ses-chat': 'chat-1' }, ['chat-1'])
    evento({ session_id: 'ses-chat', cwd: 'C:\\p', hook_event_name: 'Stop' })
    expect(enviados).toEqual([])
    // ni siquiera intenta reclamarla para un terminal del mismo proyecto
    expect(reclamos).toEqual([])
  })

  it('sigue reportando el estado de las pestañas terminal', () => {
    const { evento, enviados } = montar({}, ['chat-1'])
    evento({ session_id: 'ses-term', cwd: 'C:\\p', hook_event_name: 'Stop' })
    expect(enviados).toEqual([
      { tabId: 'terminal-1', status: 'done', detail: 'Claude terminó y espera tu siguiente instrucción' }
    ])
  })
})
