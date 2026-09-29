import { beforeEach, describe, expect, it } from 'vitest'
import { Push, type ClavesVapid, type PushStore, type SuscripcionPush } from '../src/main/remote/push'

function storeFalso(): PushStore & { llamadasSet: number } {
  let claves: ClavesVapid | undefined
  let subs: Record<string, SuscripcionPush> = {}
  return {
    llamadasSet: 0,
    get pushKeys() {
      return claves
    },
    setPushKeys(k) {
      claves = k
      this.llamadasSet++
    },
    get pushSubs() {
      return subs
    },
    setPushSubs(s) {
      subs = s
    }
  }
}

function sub(endpoint: string): SuscripcionPush {
  return { endpoint, keys: { p256dh: 'clave-publica', auth: 'secreto' } }
}

let store: ReturnType<typeof storeFalso>
let enviados: { sub: SuscripcionPush; payload: string }[]
let respuesta: number | Error

function crear(): Push {
  return new Push(
    store,
    async (s, payload) => {
      enviados.push({ sub: s, payload })
      if (respuesta instanceof Error) throw respuesta
      return { statusCode: respuesta }
    },
    () => ({ publicKey: `pub-${store.llamadasSet}`, privateKey: 'priv' })
  )
}

beforeEach(() => {
  store = storeFalso()
  enviados = []
  respuesta = 201
})

describe('claves VAPID', () => {
  it('se generan una vez y se guardan', () => {
    const push = crear()
    const primera = push.clavePublica()
    expect(push.clavePublica()).toBe(primera)
    expect(store.llamadasSet).toBe(1)
  })

  it('un par a medias se regenera: con media clave no se puede firmar', () => {
    const push = crear()
    store.setPushKeys({ publicKey: 'solo-la-publica', privateKey: '' })
    expect(push.clavePublica()).not.toBe('solo-la-publica')
  })
})

describe('suscripciones', () => {
  it('guarda la del dispositivo', () => {
    const push = crear()
    push.suscribir('c1', sub('https://fcm.googleapis.com/x'))
    expect(push.suscritos()).toEqual(['c1'])
  })

  it('una suscripción incompleta se ignora en vez de guardarse a medias', () => {
    const push = crear()
    push.suscribir('c1', { endpoint: '', keys: { p256dh: 'a', auth: 'b' } })
    push.suscribir('c2', { endpoint: 'https://x', keys: { p256dh: '', auth: 'b' } })
    expect(push.suscritos()).toEqual([])
  })

  it('volver a suscribir el mismo dispositivo reemplaza el endpoint', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://viejo'))
    push.suscribir('c1', sub('https://nuevo'))
    await push.avisar(['c1'], { titulo: 't', cuerpo: 'c' })

    expect(push.suscritos()).toEqual(['c1'])
    expect(enviados.map((e) => e.sub.endpoint)).toEqual(['https://nuevo'])
  })

  it('olvidar borra solo el indicado', () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    push.suscribir('c2', sub('https://dos'))
    push.olvidar('c1')
    expect(push.suscritos()).toEqual(['c2'])
  })
})

describe('avisos', () => {
  it('manda el aviso con la conversación a la que volver', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    expect(await push.avisar(['c1'], { titulo: 'Permiso', cuerpo: 'espera', tabId: 'tab-9' })).toBe(1)
    expect(JSON.parse(enviados[0].payload)).toEqual({
      titulo: 'Permiso',
      cuerpo: 'espera',
      tabId: 'tab-9'
    })
  })

  it('un dispositivo sin suscripción no se intenta', async () => {
    const push = crear()
    expect(await push.avisar(['fantasma'], { titulo: 't', cuerpo: 'c' })).toBe(0)
    expect(enviados).toEqual([])
  })

  it('una suscripción caducada se borra en vez de reintentarse siempre', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    respuesta = 410
    expect(await push.avisar(['c1'], { titulo: 't', cuerpo: 'c' })).toBe(0)
    expect(push.suscritos()).toEqual([])
  })

  it('también cuando el servicio lo dice lanzando', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    respuesta = Object.assign(new Error('gone'), { statusCode: 404 })
    await push.avisar(['c1'], { titulo: 't', cuerpo: 'c' })
    expect(push.suscritos()).toEqual([])
  })

  it('un fallo pasajero no borra la suscripción', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    respuesta = Object.assign(new Error('timeout'), { statusCode: 500 })
    await push.avisar(['c1'], { titulo: 't', cuerpo: 'c' })
    expect(push.suscritos()).toEqual(['c1'])
  })

  it('un dispositivo caído no impide avisar al resto', async () => {
    const push = crear()
    push.suscribir('c1', sub('https://uno'))
    push.suscribir('c2', sub('https://dos'))
    let primera = true
    const p = new Push(
      store,
      async (s) => {
        enviados.push({ sub: s, payload: '' })
        if (primera) {
          primera = false
          throw new Error('caído')
        }
        return { statusCode: 201 }
      },
      () => ({ publicKey: 'pub', privateKey: 'priv' })
    )
    expect(await p.avisar(['c1', 'c2'], { titulo: 't', cuerpo: 'c' })).toBe(1)
    expect(enviados).toHaveLength(2)
  })
})
