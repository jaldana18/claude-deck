import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bus } from '../src/main/bus'
import { Ownership } from '../src/main/ownership'
import { Auth, type AlmacenDispositivos } from '../src/main/remote/auth'
import { Dispatcher } from '../src/main/remote/dispatch'
import { Gateway } from '../src/main/remote/gateway'
import type { RemoteDevice } from '../src/shared/types'

/** Cliente web falso ya «compilado». */
const webDir = mkdtempSync(join(tmpdir(), 'deck-web-'))
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Deck</title>')
mkdirSync(join(webDir, 'assets'))
writeFileSync(join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)')
// Un archivo del que nadie debería poder tirar desde fuera de la raíz.
const fuera = mkdtempSync(join(tmpdir(), 'deck-fuera-'))
writeFileSync(join(fuera, 'secreto.txt'), 'token=1234')

afterAll(() => {
  rmSync(webDir, { recursive: true, force: true })
  rmSync(fuera, { recursive: true, force: true })
})

function almacen(): AlmacenDispositivos {
  let ds: RemoteDevice[] = []
  let hs: Record<string, string> = {}
  return {
    leer: () => ds,
    escribir: (v) => {
      ds = v
    },
    leerHashes: () => hs,
    escribirHashes: (v) => {
      hs = v
    }
  }
}

let bus: Bus
let auth: Auth
let ownership: Ownership
let gateway: Gateway
let base: string
let pedidos: [string, unknown][]
let raiz: string

beforeEach(async () => {
  pedidos = []
  raiz = webDir
  bus = new Bus(() => null)
  auth = new Auth(almacen())
  ownership = new Ownership({ send: () => 1 })
  gateway = new Gateway({
    bus,
    auth,
    ownership,
    webDir: raiz,
    version: '9.9.9',
    esperaSondeoMs: 300,
    dispatcher: new Dispatcher({
      invocar: (canal, args) => {
        pedidos.push([canal, args])
        return { hecho: canal }
      },
      puedeActuar: () => true,
      raices: () => ['C:\\proyectos']
    })
  })
  const puerto = await gateway.arrancar(0)
  base = `http://127.0.0.1:${puerto}`
})

afterEach(async () => {
  await gateway.detener()
})

async function emparejar(): Promise<string> {
  const { codigo } = auth.nuevoCodigo()
  const res = await fetch(`${base}/api/emparejar`, {
    method: 'POST',
    body: JSON.stringify({ codigo, nombre: 'Pixel' })
  })
  const { token } = (await res.json()) as { token: string }
  return token
}

interface Sondeo {
  tipo: string
  seq: number
  hueco: boolean
  clientId: string
  version?: string
  eventos: { seq: number; channel: string; payload: unknown }[]
}

async function sondear(token: string, desde: number, primera = false): Promise<Sondeo> {
  const marca = primera ? '&nuevo=1' : ''
  const res = await fetch(`${base}/api/eventos?sondeo=1&desde=${desde}${marca}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  expect(res.status).toBe(200)
  return (await res.json()) as Sondeo
}

/** Lee `n` líneas del canal de eventos y corta la conexión. */
async function lineas(
  token: string,
  n: number,
  desde = 0,
  antesDeLeer?: () => void
): Promise<Record<string, unknown>[]> {
  const ac = new AbortController()
  const res = await fetch(`${base}/api/eventos?desde=${desde}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: ac.signal
  })
  const lector = res.body!.getReader()
  const dec = new TextDecoder()
  const out: Record<string, unknown>[] = []
  let resto = ''
  antesDeLeer?.()
  while (out.length < n) {
    const { value, done } = await lector.read()
    if (done) break
    resto += dec.decode(value, { stream: true })
    const partes = resto.split('\n')
    resto = partes.pop() ?? ''
    for (const p of partes) if (p.trim()) out.push(JSON.parse(p))
  }
  ac.abort()
  return out
}

describe('Gateway: cliente web', () => {
  it('sirve el index en la raíz, sin caché y con CSP', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('los assets con hash en el nombre sí se cachean', async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('max-age')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('una ruta desconocida devuelve el index: la resuelve el cliente', async () => {
    const res = await fetch(`${base}/conversacion/tab-1`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Deck')
  })

  it('no se puede salir de la carpeta del cliente web', async () => {
    for (const ruta of [
      '/../secreto.txt',
      '/..%2fsecreto.txt',
      '/%2e%2e%2f%2e%2e%2fsecreto.txt',
      '/assets/../../secreto.txt'
    ]) {
      const res = await fetch(`${base}${ruta}`)
      expect(await res.text()).not.toContain('token=1234')
    }
  })

  it('sin cliente compilado lo dice en vez de reventar', async () => {
    await gateway.detener()
    gateway = new Gateway({
      bus,
      auth,
      ownership,
      webDir: join(webDir, 'no-existe'),
      dispatcher: new Dispatcher({ invocar: () => null, puedeActuar: () => true, raices: () => [] })
    })
    const puerto = await gateway.arrancar(0)
    const res = await fetch(`http://127.0.0.1:${puerto}/`)
    expect(res.status).toBe(503)
  })
})

describe('Gateway: emparejar', () => {
  it('con el código bueno entrega token y clientId', async () => {
    const { codigo } = auth.nuevoCodigo()
    const res = await fetch(`${base}/api/emparejar`, {
      method: 'POST',
      body: JSON.stringify({ codigo, nombre: 'Pixel' })
    })
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as { token: string; clientId: string }
    expect(cuerpo.token).toBeTruthy()
    expect(cuerpo.clientId).toBeTruthy()
  })

  it('con el código malo devuelve 401 y no crea dispositivo', async () => {
    auth.nuevoCodigo()
    const res = await fetch(`${base}/api/emparejar`, {
      method: 'POST',
      body: JSON.stringify({ codigo: 'ZZZZZZZZ', nombre: 'x' })
    })
    expect(res.status).toBe(401)
    expect(auth.dispositivos()).toEqual([])
  })

  it('un cuerpo que no es JSON no tumba el servidor', async () => {
    const res = await fetch(`${base}/api/emparejar`, { method: 'POST', body: 'basura{' })
    expect(res.status).toBe(401)
  })

  it('un GET a emparejar no vale', async () => {
    expect((await fetch(`${base}/api/emparejar`)).status).toBe(405)
  })
})

describe('Gateway: acciones', () => {
  it('sin token no se ejecuta nada', async () => {
    const res = await fetch(`${base}/api/accion`, {
      method: 'POST',
      body: JSON.stringify({ canal: 'chat:snapshotAll' })
    })
    expect(res.status).toBe(401)
    expect(pedidos).toEqual([])
  })

  it('con un token inventado tampoco', async () => {
    await emparejar()
    const res = await fetch(`${base}/api/accion`, {
      method: 'POST',
      headers: { Authorization: 'Bearer no-soy-un-token' },
      body: JSON.stringify({ canal: 'chat:snapshotAll' })
    })
    expect(res.status).toBe(401)
    expect(pedidos).toEqual([])
  })

  it('con token bueno llega al main', async () => {
    const token = await emparejar()
    const res = await fetch(`${base}/api/accion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ canal: 'chat:snapshot', args: 'tab-1' })
    })
    expect(await res.json()).toEqual({ ok: true, data: { hecho: 'chat:snapshot' } })
    expect(pedidos).toEqual([['chat:snapshot', 'tab-1']])
  })

  it('un canal fuera de la superficie se rechaza con 200 y motivo, no con un 500', async () => {
    const token = await emparejar()
    const res = await fetch(`${base}/api/accion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ canal: 'pty:input', args: { data: 'whoami\r' } })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, motivo: 'no-permitido' })
    expect(pedidos).toEqual([])
  })

  it('un cuerpo enorme se corta', async () => {
    const token = await emparejar()
    const res = await fetch(`${base}/api/accion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ canal: 'chat:send', args: { relleno: 'x'.repeat(9 * 1024 * 1024) } })
    })
    expect(res.status).toBe(413)
    expect(pedidos).toEqual([])
  })
})

describe('Gateway: canal de eventos', () => {
  it('sin token no se abre', async () => {
    const res = await fetch(`${base}/api/eventos`)
    expect(res.status).toBe(401)
  })

  it('saluda con el último seq y va entregando lo que se emite', async () => {
    const token = await emparejar()
    const vistas = await lineas(token, 2, 0, () => {
      setTimeout(() => bus.send('chat:message', { tabId: 'tab-1' }), 10)
    })
    expect(vistas[0]).toMatchObject({ tipo: 'hola', hueco: false, version: '9.9.9' })
    expect(vistas[1]).toMatchObject({ tipo: 'evento', channel: 'chat:message' })
  })

  it('no reenvía eventos que no son de la superficie remota', async () => {
    const token = await emparejar()
    const vistas = await lineas(token, 2, 0, () => {
      setTimeout(() => {
        bus.send('pty:data', { paneId: 'p', data: 'secreto' })
        bus.send('update:available', { version: '9' })
        bus.send('chat:result', { tabId: 'tab-1' })
      }, 10)
    })
    expect(vistas[1]).toMatchObject({ channel: 'chat:result' })
    expect(JSON.stringify(vistas)).not.toContain('secreto')
  })

  it('reenvía lo perdido cuando el cliente vuelve con su último seq', async () => {
    const token = await emparejar()
    bus.send('chat:message', { n: 1 })
    bus.send('chat:message', { n: 2 })
    const vistas = await lineas(token, 2, 1)
    expect(vistas[0]).toMatchObject({ tipo: 'hola', hueco: false })
    expect(vistas.slice(1).map((v) => (v.payload as { n: number }).n)).toEqual([2])
  })

  it('avisa del hueco cuando lo perdido ya no está en el anillo', async () => {
    const token = await emparejar()
    const chico = new Bus(() => null, 5)
    await gateway.detener()
    gateway = new Gateway({
      bus: chico,
      auth,
      ownership,
      webDir: raiz,
      dispatcher: new Dispatcher({ invocar: () => null, puedeActuar: () => true, raices: () => [] })
    })
    const puerto = await gateway.arrancar(0)
    base = `http://127.0.0.1:${puerto}`
    for (let i = 0; i < 40; i++) chico.send('chat:delta', { i })

    const vistas = await lineas(token, 1, 1)
    expect(vistas[0]).toMatchObject({ tipo: 'hola', hueco: true })
  })

  it('el dispositivo conectado cuenta como cliente y suelta al irse', async () => {
    const token = await emparejar()
    expect(gateway.conectados).toEqual([])
    await lineas(token, 1)
    expect(gateway.conectados).toHaveLength(1)

    // cortada la conexión, el dispositivo deja de estar presente
    await new Promise((r) => setTimeout(r, 60))
    expect(gateway.conectados).toEqual([])
  })

  it('el servidor dice su versión: así el móvil sabe si su cliente se quedó viejo', async () => {
    const res = await fetch(`${base}/api/deck`)
    expect(await res.json()).toEqual({ deck: true, version: '9.9.9' })
  })

  // El túnel retiene el cuerpo de una respuesta que no termina, así que el
  // transporte de verdad es este: una respuesta por lote, y se cierra.
  it('el primer sondeo contesta en el acto, con la versión y sin arrastrar el pasado', async () => {
    const token = await emparejar()
    bus.send('chat:message', { tabId: 'tab-1' })
    const r = await sondear(token, 0, true)

    expect(r).toMatchObject({ tipo: 'sondeo', hueco: false, version: '9.9.9' })
    expect(r.eventos).toEqual([])
    expect(r.seq).toBeGreaterThan(0)
    expect(r.clientId).toBeTruthy()
  })

  it('un sondeo se queda esperando y trae el evento que pase', async () => {
    const token = await emparejar()
    const desde = (await sondear(token, 0, true)).seq
    setTimeout(() => bus.send('chat:delta', { tabId: 'tab-1', text: 'hola' }), 30)
    const r = await sondear(token, desde)

    expect(r.eventos.map((e) => e.channel)).toEqual(['chat:delta'])
  })

  it('lo que pasó entre dos sondeos no se pierde', async () => {
    const token = await emparejar()
    const desde = (await sondear(token, 0, true)).seq
    bus.send('chat:message', { tabId: 'tab-1' })
    bus.send('chat:result', { tabId: 'tab-1' })
    const r = await sondear(token, desde)

    expect(r.eventos.map((e) => e.channel)).toEqual(['chat:message', 'chat:result'])
  })

  it('sin novedades contesta vacío en vez de quedarse colgado', async () => {
    const token = await emparejar()
    const desde = (await sondear(token, 0, true)).seq
    const t0 = Date.now()
    const r = await sondear(token, desde)

    expect(r.eventos).toEqual([])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250)
  })

  it('no reenvía por sondeo lo que no es de la superficie remota', async () => {
    const token = await emparejar()
    const desde = (await sondear(token, 0, true)).seq
    bus.send('pty:data', { paneId: 'p', data: 'secreto' })
    bus.send('chat:message', { tabId: 'tab-1' })
    const r = await sondear(token, desde)

    expect(r.eventos.map((e) => e.channel)).toEqual(['chat:message'])
  })

  it('quien sondea cuenta como conectado y tiene el control registrado', async () => {
    const token = await emparejar()
    const r = await sondear(token, 0, true)

    expect(gateway.conectados).toEqual([r.clientId])
    expect(ownership.claim('tab-1', r.clientId).connected).toBe(true)
  })

  it('un sondeo sin token no pasa', async () => {
    const res = await fetch(`${base}/api/eventos?sondeo=1&desde=0`)
    expect(res.status).toBe(401)
  })

  it('detener cierra el servidor', async () => {
    await gateway.detener()
    await expect(fetch(`${base}/api/deck`)).rejects.toThrow()
  })
})
