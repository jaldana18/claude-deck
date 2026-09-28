import { describe, expect, it } from 'vitest'
import { ChatSession } from '../src/main/chatSession'
import type { Emitter } from '../src/main/bus'
import type { Store } from '../src/main/store'
import type { PermissionRequestEvent, QuestionRequestEvent, TabState } from '../src/shared/types'

const busMudo: Emitter = { send: () => 0 }
const storeFalso = { updateTab: () => undefined } as unknown as Store

function pestana(extra: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'factura',
    cwd: 'C:\\proyecto',
    mode: 'chat',
    ...extra
  } as TabState
}

/** Acceso a los privados que el snapshot debe reflejar. */
type Interno = {
  pendingPermissions: Map<string, { event: PermissionRequestEvent }>
  pendingQuestions: Map<string, { event: QuestionRequestEvent }>
  streamingId: string | null
  streamingText: string
  turnoEnCurso: boolean
}

function crear(extra?: Partial<TabState>): { sesion: ChatSession; dentro: Interno } {
  const sesion = new ChatSession(pestana(extra), storeFalso, busMudo)
  return { sesion, dentro: sesion as unknown as Interno }
}

describe('SessionSnapshot', () => {
  it('una sesión recién creada no reporta trabajo en curso ni pendientes', () => {
    const { sesion } = crear()
    const s = sesion.snapshot()

    expect(s.tabId).toBe('tab-1')
    expect(s.busy).toBe(false)
    expect(s.streaming).toBeNull()
    expect(s.permissions).toEqual([])
    expect(s.questions).toEqual([])
    expect(s.todos).toEqual([])
  })

  it('entrega el mensaje a medio escribir para que un cliente tardío lo vea', () => {
    const { sesion, dentro } = crear()
    dentro.streamingId = 'msg-9'
    dentro.streamingText = 'Voy por la mitad de la respu'

    expect(sesion.snapshot().streaming).toEqual({
      messageId: 'msg-9',
      text: 'Voy por la mitad de la respu'
    })
  })

  it('reentrega los permisos pendientes tal cual se emitieron', () => {
    const { sesion, dentro } = crear()
    const evento: PermissionRequestEvent = {
      tabId: 'tab-1',
      requestId: 'req-1',
      toolName: 'Bash',
      inputPreview: '{"command":"npm test"}',
      canAlwaysAllow: true
    }
    dentro.pendingPermissions.set('req-1', { event: evento })

    // misma referencia: el snapshot no recalcula el payload, lo reenvía
    expect(sesion.snapshot().permissions[0]).toBe(evento)
  })

  it('reentrega las preguntas pendientes', () => {
    const { sesion, dentro } = crear()
    const evento = {
      tabId: 'tab-1',
      requestId: 'q-1',
      questions: []
    } as unknown as QuestionRequestEvent
    dentro.pendingQuestions.set('q-1', { event: evento })

    expect(sesion.snapshot().questions).toEqual([evento])
  })

  it('refleja el turno en vuelo', () => {
    const { sesion, dentro } = crear()
    dentro.turnoEnCurso = true
    expect(sesion.snapshot().busy).toBe(true)
  })

  it('resiembra la salud persistida: tras reiniciar no arranca en cero', () => {
    const { sesion } = crear({
      lastHealth: { tabId: 'tab-1', contextTokens: 42_000, costUsd: 1.5 }
    } as Partial<TabState>)

    const s = sesion.snapshot()
    expect(s.health.contextTokens).toBe(42_000)
    expect(s.health.costUsd).toBe(1.5)
  })
})
