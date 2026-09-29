import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bus } from '../src/main/bus'
import { Ownership } from '../src/main/ownership'
import { RemoteManager, type RemoteStore } from '../src/main/remote/manager'
import type { EstadoTunel, Tunnel } from '../src/main/remote/tunnel'
import type { RemoteDevice, RemoteSettings, RemoteStatus, TabState } from '../src/shared/types'

const webDir = mkdtempSync(join(tmpdir(), 'deck-web-mgr-'))
writeFileSync(join(webDir, 'index.html'), '<!doctype html>')
afterAll(() => rmSync(webDir, { recursive: true, force: true }))

function storeFalso(inicial: Partial<RemoteSettings> = {}, cwds: string[] = []): RemoteStore {
  let remote: RemoteSettings = { enabled: false, puerto: 0, tunel: 'quick', ...inicial }
  let devices: RemoteDevice[] = []
  let hashes: Record<string, string> = {}
  let claves: { publicKey: string; privateKey: string } | undefined
  let subs: Record<string, { endpoint: string; keys: { p256dh: string; auth: string } }> = {}
  return {
    get remote() {
      return remote
    },
    setRemote(patch) {
      remote = { ...remote, ...patch }
      return remote
    },
    get remoteDevices() {
      return devices
    },
    setRemoteDevices(ds) {
      devices = ds
    },
    get remoteHashes() {
      return hashes
    },
    setRemoteHashes(h) {
      hashes = h
    },
    get tabs() {
      return cwds.map((cwd, i) => ({ id: `t${i}`, cwd }) as TabState)
    },
    get pushKeys() {
      return claves
    },
    setPushKeys(k) {
      claves = k
    },
    get pushSubs() {
      return subs
    },
    setPushSubs(v) {
      subs = v
    }
  }
}

/** Túnel de mentira: el test decide cuándo y con qué estado avisa. */
function tunelFalso(): {
  crear: (onCambio: (e: EstadoTunel) => void) => Tunnel
  cambiar: (e: EstadoTunel) => void
  arranques: number
  paradas: () => number
} {
  let avisar: ((e: EstadoTunel) => void) | null = null
  const cuenta = { arranques: 0, paradas: 0 }
  const crear = (onCambio: (e: EstadoTunel) => void): Tunnel => {
    avisar = onCambio
    return {
      estado: { fase: 'apagado', url: null },
      arrancar: () => {
        cuenta.arranques++
      },
      detener: () => {
        cuenta.paradas++
      }
    } as unknown as Tunnel
  }
  return {
    crear,
    cambiar: (e) => avisar?.(e),
    get arranques() {
      return cuenta.arranques
    },
    paradas: () => cuenta.paradas
  }
}

let anuncios: RemoteStatus[]
let gestores: RemoteManager[]

function montar(
  ajustes: Partial<RemoteSettings> = {},
  cwds: string[] = []
): { m: RemoteManager; store: RemoteStore; tunel: ReturnType<typeof tunelFalso> } {
  const store = storeFalso(ajustes, cwds)
  const bus = new Bus(() => null)
  bus.subscribe((ev) => {
    if (ev.channel === 'remote:status') anuncios.push(ev.payload as RemoteStatus)
  })
  const tunel = tunelFalso()
  const m = new RemoteManager({
    store,
    bus,
    ownership: new Ownership({ send: () => 1 }),
    invocar: () => 'ok',
    webDir,
    crearTunel: tunel.crear
  })
  gestores.push(m)
  return { m, store, tunel }
}

beforeEach(() => {
  anuncios = []
  gestores = []
})

afterEach(async () => {
  for (const m of gestores) await m.detener()
})

describe('carpetas visibles', () => {
  it('por defecto son las de las pestañas y su carpeta madre', () => {
    const { m } = montar({}, ['C:\\proyectos\\api', 'C:\\proyectos\\web'])
    expect(m.raices().sort()).toEqual(['C:\\proyectos', 'C:\\proyectos\\api', 'C:\\proyectos\\web'])
  })

  it('una lista explícita manda sobre las pestañas', () => {
    const { m } = montar({ raices: ['D:\\solo-esto'] }, ['C:\\proyectos\\api'])
    expect(m.raices()).toEqual(['D:\\solo-esto'])
  })

  it('sin pestañas no hay nada visible', () => {
    expect(montar().m.raices()).toEqual([])
  })
})

describe('encendido', () => {
  it('arranca apagado y no publica nada', () => {
    const { m } = montar()
    expect(m.estado().enabled).toBe(false)
    expect(m.estado().url).toBeNull()
  })

  it('encender levanta el servidor, lanza el túnel y lo recuerda', async () => {
    const { m, store, tunel } = montar()
    const s = await m.encender()
    expect(s.enabled).toBe(true)
    expect(tunel.arranques).toBe(1)
    expect(store.remote.enabled).toBe(true)
  })

  it('en red local no se lanza túnel y la dirección es la de la wifi', async () => {
    const { m, tunel } = montar({ tunel: 'ninguno' })
    const s = await m.encender()
    expect(tunel.arranques).toBe(0)
    // en un PC sin red la IP puede no existir: entonces no hay dirección que dar
    if (s.url !== null) expect(s.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/)
  })

  it('apagar cierra el túnel y lo deja anotado para el próximo arranque', async () => {
    const { m, store, tunel } = montar()
    await m.encender()
    await m.apagar()
    expect(tunel.paradas()).toBeGreaterThan(0)
    expect(store.remote.enabled).toBe(false)
    expect(m.estado().tunel).toBe('apagado')
  })

  it('restaurar no publica nada si quedó apagado', async () => {
    const { m, tunel } = montar({ enabled: false })
    await m.restaurar()
    expect(m.estado().enabled).toBe(false)
    expect(tunel.arranques).toBe(0)
  })

  it('cerrar la app no desactiva el acceso: al arrancar vuelve a publicarse', async () => {
    const { m, store } = montar()
    await m.encender()
    await m.detener()
    expect(store.remote.enabled).toBe(true)
    expect(m.estado().enabled).toBe(false)
  })

  it('restaurar vuelve a publicar si quedó encendido', async () => {
    const { m } = montar({ enabled: true })
    await m.restaurar()
    expect(m.estado().enabled).toBe(true)
  })

  it('cambiar el modo de túnel estando encendido reinicia', async () => {
    const { m, tunel } = montar()
    await m.encender()
    await m.aplicar({ tunel: 'ninguno' })
    expect(tunel.paradas()).toBeGreaterThan(0)
    expect(m.estado().enabled).toBe(true)
  })

  it('un cambio que no afecta al servidor no lo reinicia', async () => {
    const { m, tunel } = montar()
    await m.encender()
    const paradas = tunel.paradas()
    await m.aplicar({ apagarTrasMin: 60 })
    expect(tunel.paradas()).toBe(paradas)
  })
})

describe('dirección pública', () => {
  it('con túnel rápido la da cloudflared', async () => {
    const { m, tunel } = montar()
    await m.encender()
    expect(m.estado().url).toBeNull()
    tunel.cambiar({ fase: 'activo', url: 'https://algo-raro.trycloudflare.com' })
    expect(m.estado()).toMatchObject({
      url: 'https://algo-raro.trycloudflare.com',
      tunel: 'activo'
    })
  })

  it('con dominio propio sale del hostname, sin esperar al túnel', async () => {
    const { m } = montar({ tunel: 'dominio', hostname: 'deck.midominio.com', tunelToken: 'eyJ' })
    await m.encender()
    expect(m.estado().url).toBe('https://deck.midominio.com')
  })

  it('con dominio y sin hostname no hay dirección que ofrecer', async () => {
    const { m } = montar({ tunel: 'dominio', tunelToken: 'eyJ' })
    await m.encender()
    expect(m.estado().url).toBeNull()
  })
})

describe('emparejamiento', () => {
  it('no se empareja con el acceso apagado', () => {
    expect(montar().m.emparejar().error).toBeTruthy()
  })

  it('sin dirección todavía, lo dice en vez de dar un QR inútil', async () => {
    const { m } = montar()
    await m.encender()
    expect(m.emparejar().error).toBeTruthy()
  })

  it('con dirección entrega una url con el código en el fragmento', async () => {
    const { m } = montar({ tunel: 'dominio', hostname: 'deck.midominio.com' })
    await m.encender()
    const r = m.emparejar()
    expect(r.pairing?.url).toBe(`https://deck.midominio.com/#c=${r.pairing?.codigo}`)
    // el código va en el fragmento: así no llega al servidor ni a sus registros
    expect(r.pairing?.url).toContain('/#c=')
  })

  it('el estado lleva el emparejamiento abierto para que el panel pinte el QR', async () => {
    const { m } = montar({ tunel: 'dominio', hostname: 'deck.midominio.com' })
    await m.encender()
    m.emparejar()
    expect(m.estado().pairing).toBeTruthy()
  })
})

describe('avisos del túnel', () => {
  it('una caída se cuenta como alerta', async () => {
    const { m, tunel } = montar()
    await m.encender()
    tunel.cambiar({ fase: 'caido', url: null, detalle: 'cloudflared murió' })
    expect(m.estado().alerta).toContain('cloudflared murió')
  })

  it('volver a estar activo limpia la alerta', async () => {
    const { m, tunel } = montar()
    await m.encender()
    tunel.cambiar({ fase: 'caido', url: null, detalle: 'se cayó' })
    tunel.cambiar({ fase: 'activo', url: 'https://uno.trycloudflare.com' })
    expect(m.estado().alerta).toBeUndefined()
  })

  it('una dirección nueva avisa de que hay que volver a escanear', async () => {
    const { m, tunel } = montar()
    await m.encender()
    tunel.cambiar({ fase: 'activo', url: 'https://uno.trycloudflare.com' })
    tunel.cambiar({ fase: 'activo', url: 'https://dos.trycloudflare.com' })
    expect(m.estado().alerta).toContain('escanear')
  })

  it('con un dispositivo ya emparejado, la dirección nueva abre código sin pedirlo', async () => {
    const { m, store, tunel } = montar()
    store.setRemoteDevices([{ clientId: 'c1', nombre: 'Pixel', creado: 1 }])
    await m.encender()
    tunel.cambiar({ fase: 'activo', url: 'https://uno.trycloudflare.com' })
    expect(m.estado().pairing).toBeUndefined()

    tunel.cambiar({ fase: 'activo', url: 'https://dos.trycloudflare.com' })
    // el móvil tenía la dirección vieja: se le deja el QR preparado
    expect(m.estado().pairing?.url).toContain('https://dos.trycloudflare.com/#c=')
  })

  it('sin dispositivos, una dirección nueva no abre ninguna puerta', async () => {
    const { m, tunel } = montar()
    await m.encender()
    tunel.cambiar({ fase: 'activo', url: 'https://uno.trycloudflare.com' })
    tunel.cambiar({ fase: 'activo', url: 'https://dos.trycloudflare.com' })
    expect(m.estado().pairing).toBeUndefined()
  })

  it('cada cambio se anuncia al PC', async () => {
    const { m, tunel } = montar()
    await m.encender()
    anuncios.length = 0
    tunel.cambiar({ fase: 'activo', url: 'https://uno.trycloudflare.com' })
    expect(anuncios.at(-1)).toMatchObject({ tunel: 'activo' })
  })
})

describe('dispositivos', () => {
  it('revocar los deja sin llave', async () => {
    const { m } = montar({ tunel: 'dominio', hostname: 'deck.midominio.com' })
    await m.encender()
    m.emparejar()
    expect(m.estado().dispositivos).toEqual([])

    m.revocarTodos()
    expect(m.estado().dispositivos).toEqual([])
    // y cierra la ventana de emparejamiento abierta
    expect(m.estado().pairing).toBeUndefined()
  })
})
