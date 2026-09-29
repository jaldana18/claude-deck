import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Bus } from '../src/main/bus'
import { Ownership } from '../src/main/ownership'
import { Auth } from '../src/main/remote/auth'
import { Dispatcher } from '../src/main/remote/dispatch'
import { Gateway } from '../src/main/remote/gateway'
import type { RemoteDevice } from '../src/shared/types'

/**
 * Sirve el cliente web de verdad —el compilado— por el gateway de verdad.
 *
 * Es el único punto donde se comprueban juntas dos cosas que se rompen por
 * separado y en silencio: que las rutas de los assets que genera vite coincidan
 * con lo que el servidor sabe servir, y que el build del cliente esté hecho.
 * Se salta si no hay compilado: en un clon recién bajado no hay nada que probar.
 */

const WEB = 'out/web'
const compilado = existsSync(`${WEB}/index.html`)

let gateway: Gateway
let base: string

beforeAll(async () => {
  if (!compilado) return
  const almacen = (() => {
    let ds: RemoteDevice[] = []
    let hs: Record<string, string> = {}
    return {
      leer: () => ds,
      escribir: (v: RemoteDevice[]) => {
        ds = v
      },
      leerHashes: () => hs,
      escribirHashes: (v: Record<string, string>) => {
        hs = v
      }
    }
  })()
  gateway = new Gateway({
    bus: new Bus(() => null),
    auth: new Auth(almacen),
    ownership: new Ownership({ send: () => 1 }),
    webDir: WEB,
    dispatcher: new Dispatcher({ invocar: () => null, puedeActuar: () => true, raices: () => [] })
  })
  base = `http://127.0.0.1:${await gateway.arrancar(0)}`
})

afterAll(async () => {
  if (compilado) await gateway.detener()
})

describe.skipIf(!compilado)('cliente web compilado', () => {
  it('el index se sirve y trae su armazón', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<div id="app"')
    expect(html).toContain('manifest.webmanifest')
  })

  it('todos los assets que pide el index existen en el servidor', async () => {
    const html = readFileSync(`${WEB}/index.html`, 'utf8')
    const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1].slice(1))
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      const res = await fetch(`${base}${ref}`)
      expect(res.status, ref).toBe(200)
      // si una ruta cae en el index por descarte, el cliente cargaría HTML
      // donde espera JavaScript y fallaría con un error incomprensible
      expect(res.headers.get('content-type'), ref).not.toContain('text/html')
    }
  })

  it('el manifest y el service worker se sirven con su tipo', async () => {
    const manifest = await fetch(`${base}/manifest.webmanifest`)
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json')
    const datos = (await manifest.json()) as { start_url: string; display: string; icons: unknown[] }
    expect(datos.display).toBe('standalone')
    expect(datos.icons.length).toBeGreaterThan(0)

    const sw = await fetch(`${base}/sw.js`)
    expect(sw.status).toBe(200)
    expect(sw.headers.get('content-type')).toContain('javascript')
  })
})
