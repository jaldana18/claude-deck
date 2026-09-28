import { describe, expect, it } from 'vitest'
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk'
import { ChatSession } from '../src/main/chatSession'
import type { Emitter } from '../src/main/bus'
import type { Store } from '../src/main/store'
import type { TabState } from '../src/shared/types'

/**
 * Ejercita el bucle que consume el SDK sin lanzar el CLI: la sesión recibe un
 * `query()` falso que el test alimenta mensaje a mensaje. Cubre el streaming
 * acumulado, el guardado del evento de permiso y el ciclo de turno, que son las
 * tres cosas que el snapshot necesita correctas para que un segundo dispositivo
 * se incorpore a una conversación en marcha.
 */

const storeFalso = {
  updateTab: () => undefined,
  globalSettings: { autoCompactTokens: 0 }
} as unknown as Store

function pestana(): TabState {
  return { id: 'tab-1', title: 'chat', cwd: 'C:\\proyecto', mode: 'chat' } as TabState
}

/** Generador que el test controla: `emitir` entrega el siguiente mensaje. */
function sdkFalso(): { q: Query; emitir: (msg: unknown) => void; cerrar: () => void } {
  const pendientes: unknown[] = []
  let despertar: (() => void) | null = null
  let terminado = false

  async function* gen(): AsyncGenerator<unknown> {
    while (true) {
      while (pendientes.length > 0) yield pendientes.shift()!
      if (terminado) return
      await new Promise<void>((r) => {
        despertar = r
      })
    }
  }

  const q = Object.assign(gen(), {
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    supportedCommands: async () => [],
    supportedModels: async () => []
  })

  const soltar = (): void => {
    const d = despertar
    despertar = null
    d?.()
  }

  return {
    q: q as unknown as Query,
    emitir: (msg) => {
      pendientes.push(msg)
      soltar()
    },
    cerrar: () => {
      terminado = true
      soltar()
    }
  }
}

/** Cede el control al bucle para que consuma lo emitido. */
const ceder = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function montar(): {
  sesion: ChatSession
  sdk: ReturnType<typeof sdkFalso>
  eventos: [string, unknown][]
  opciones: () => Options
} {
  const eventos: [string, unknown][] = []
  const bus: Emitter = {
    send: (channel, payload) => {
      eventos.push([channel, payload])
      return 1
    }
  }
  const sdk = sdkFalso()
  let capturadas: Options | null = null
  const sesion = new ChatSession(pestana(), storeFalso, bus, undefined, (args) => {
    capturadas = args.options
    return sdk.q
  })
  sesion.start()
  return { sesion, sdk, eventos, opciones: () => capturadas as unknown as Options }
}

const delta = (text: string): unknown => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }
})

const resultado = (): unknown => ({
  type: 'result',
  subtype: 'success',
  session_id: 'sesion-sdk',
  total_cost_usd: 0.02,
  usage: { input_tokens: 10, output_tokens: 4 },
  num_turns: 1,
  is_error: false
})

describe('bucle del SDK', () => {
  it('acumula el texto en vuelo para quien llegue a mitad de mensaje', async () => {
    const { sesion, sdk } = montar()
    sdk.emitir({ type: 'stream_event', event: { type: 'message_start' } })
    sdk.emitir(delta('Voy por '))
    sdk.emitir(delta('la mitad'))
    await ceder()

    const s = sesion.snapshot()
    expect(s.streaming?.text).toBe('Voy por la mitad')
    expect(s.streaming?.messageId).toBeTruthy()
    sesion.stop()
  })

  it('al cerrar el mensaje deja de haber texto en vuelo', async () => {
    const { sesion, sdk, eventos } = montar()
    sdk.emitir({ type: 'stream_event', event: { type: 'message_start' } })
    sdk.emitir(delta('listo'))
    sdk.emitir({
      type: 'assistant',
      uuid: 'u-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'listo' }] }
    })
    await ceder()

    expect(sesion.snapshot().streaming).toBeNull()
    const mensaje = eventos.find(([c]) => c === 'chat:message')
    expect(mensaje?.[1]).toMatchObject({ tabId: 'tab-1', replacesStreaming: true })
    sesion.stop()
  })

  it('un permiso pendiente queda en el snapshot y se resuelve al aprobarlo', async () => {
    const { sesion, eventos, opciones } = montar()
    const ac = new AbortController()
    const decision = opciones().canUseTool!(
      'Bash',
      { command: 'npm test' },
      { signal: ac.signal, requestId: 'req-1', suggestions: [{ type: 'addRules' }] } as never
    )
    await ceder()

    const s = sesion.snapshot()
    expect(s.permissions).toHaveLength(1)
    expect(s.permissions[0]).toMatchObject({
      requestId: 'req-1',
      toolName: 'Bash',
      canAlwaysAllow: true
    })
    // el snapshot reentrega el mismo objeto que se emitió por push
    expect(s.permissions[0]).toBe(eventos.find(([c]) => c === 'chat:permission-request')?.[1])

    sesion.resolvePermission('req-1', 'allow')
    await expect(decision).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { command: 'npm test' }
    })
    expect(sesion.snapshot().permissions).toEqual([])
    sesion.stop()
  })

  it('cancelar desde el SDK retira el permiso del snapshot', async () => {
    const { sesion, opciones } = montar()
    const ac = new AbortController()
    const decision = opciones().canUseTool!(
      'Write',
      { file_path: 'x.ts' },
      { signal: ac.signal, requestId: 'req-2' } as never
    )
    await ceder()
    expect(sesion.snapshot().permissions).toHaveLength(1)

    ac.abort()
    await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
    expect(sesion.snapshot().permissions).toEqual([])
    sesion.stop()
  })

  it('una pregunta pendiente viaja en el snapshot y la respuesta vuelve en el input', async () => {
    const { sesion, opciones } = montar()
    const ac = new AbortController()
    const preguntas = [{ question: 'Sigo?', header: 'Rumbo', options: [], multiSelect: false }]
    const decision = opciones().canUseTool!(
      'AskUserQuestion',
      { questions: preguntas },
      { signal: ac.signal, requestId: 'q-1' } as never
    )
    await ceder()

    expect(sesion.snapshot().questions).toMatchObject([{ requestId: 'q-1', questions: preguntas }])

    sesion.resolveQuestion('q-1', { 'Sigo?': 'Si' })
    await expect(decision).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Sigo?': 'Si' } }
    })
    expect(sesion.snapshot().questions).toEqual([])
    sesion.stop()
  })

  it('el turno se marca al enviar y se libera con el result', async () => {
    const { sesion, sdk } = montar()
    expect(sesion.snapshot().busy).toBe(false)

    sesion.sendUserText('hola')
    expect(sesion.snapshot().busy).toBe(true)

    sdk.emitir(resultado())
    await ceder()
    expect(sesion.snapshot().busy).toBe(false)
    sesion.stop()
  })

  it('lo que escribe una persona se refleja al instante a todos los clientes', () => {
    const { sesion, eventos } = montar()
    sesion.sendUserText('arregla el login', undefined, 'usuario')

    const eco = eventos.find(([c]) => c === 'chat:message')?.[1] as {
      echo?: boolean
      message: { role: string; text: string; id: string }
    }
    expect(eco.echo).toBe(true)
    expect(eco.message).toMatchObject({ role: 'user', text: 'arregla el login' })
    // id propio del main: el otro dispositivo necesita una clave estable
    expect(eco.message.id.startsWith('usuario-')).toBe(true)
    sesion.stop()
  })

  it('las imágenes adjuntas viajan en el eco: el otro dispositivo no las tiene', () => {
    const { sesion, eventos } = montar()
    sesion.sendUserText(
      'mira esto',
      [{ name: 'a.png', mediaType: 'image/png', dataBase64: 'AAA' }],
      'usuario'
    )
    const eco = eventos.find(([c]) => c === 'chat:message')?.[1] as {
      message: { images?: string[] }
    }
    expect(eco.message.images).toEqual(['data:image/png;base64,AAA'])
    sesion.stop()
  })

  it('los envíos de la propia app no se reflejan', () => {
    const { sesion, eventos } = montar()
    sesion.sendUserText('continúa donde quedaste')
    expect(eventos.some(([c]) => c === 'chat:message')).toBe(false)
    sesion.stop()
  })

  it('/clear no se refleja como mensaje', () => {
    const { sesion, eventos } = montar()
    sesion.sendUserText('/clear', undefined, 'usuario')
    expect(eventos.some(([c]) => c === 'chat:message')).toBe(false)
    sesion.stop()
  })

  it('el result actualiza la salud que verá el cliente remoto', async () => {
    const { sesion, sdk } = montar()
    sdk.emitir({
      type: 'assistant',
      uuid: 'u-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ya' }],
        usage: { input_tokens: 1_000, cache_read_input_tokens: 5_000, output_tokens: 20 }
      }
    })
    sdk.emitir(resultado())
    await ceder()

    const salud = sesion.snapshot().health
    expect(salud.contextTokens).toBe(6_000)
    expect(salud.costUsd).toBe(0.02)
    expect(salud.numTurns).toBe(1)
    sesion.stop()
  })
})
