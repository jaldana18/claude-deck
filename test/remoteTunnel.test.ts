import { describe, expect, it } from 'vitest'
import {
  Tunnel,
  rutaCloudflared,
  type EstadoTunel,
  type ProcesoTunel
} from '../src/main/remote/tunnel'

const X86 = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
const PF = 'C:\\Program Files\\cloudflared\\cloudflared.exe'

interface ProcesoFalso {
  proc: ProcesoTunel
  out: (s: string) => void
  err: (s: string) => void
  exit: (code: number | null) => void
  muertes: number
}

function procesoFalso(): ProcesoFalso {
  const oyentes = {
    out: [] as ((c: Buffer | string) => void)[],
    err: [] as ((c: Buffer | string) => void)[],
    exit: [] as ((code: number | null) => void)[]
  }
  const f: ProcesoFalso = {
    muertes: 0,
    out: (s) => oyentes.out.forEach((cb) => cb(s)),
    err: (s) => oyentes.err.forEach((cb) => cb(s)),
    exit: (code) => oyentes.exit.forEach((cb) => cb(code)),
    proc: {
      stdout: {
        on: (_ev, cb) => {
          oyentes.out.push(cb)
        }
      },
      stderr: {
        on: (_ev, cb) => {
          oyentes.err.push(cb)
        }
      },
      on: (_ev, cb) => {
        oyentes.exit.push(cb)
      },
      kill: () => {
        f.muertes += 1
      }
    }
  }
  return f
}

interface Programado {
  ms: number
  fn: () => void
  cancelado: boolean
}

interface Banco {
  t: Tunnel
  estados: EstadoTunel[]
  lanzamientos: { cmd: string; args: string[] }[]
  procesos: ProcesoFalso[]
  ultimo: () => ProcesoFalso
  timers: Programado[]
  vivos: () => Programado[]
  disparar: (ms: number) => void
  avanzar: (ms: number) => void
}

function montar(opciones: { fallaSpawn?: boolean } = {}): Banco {
  const estados: EstadoTunel[] = []
  const lanzamientos: { cmd: string; args: string[] }[] = []
  const procesos: ProcesoFalso[] = []
  const timers: Programado[] = []
  let reloj = 1_700_000_000_000
  const banco: Banco = {
    estados,
    lanzamientos,
    procesos,
    timers,
    ultimo: () => procesos[procesos.length - 1],
    vivos: () => timers.filter((x) => !x.cancelado),
    disparar: (ms) => {
      const p = timers.find((x) => !x.cancelado && x.ms === ms)
      if (!p) throw new Error(`no hay temporizador pendiente de ${ms} ms`)
      p.cancelado = true
      p.fn()
    },
    avanzar: (ms) => {
      reloj += ms
    },
    t: new Tunnel({
      onCambio: (e) => estados.push(e),
      ahora: () => reloj,
      programar: (fn, ms) => {
        const p: Programado = { ms, fn, cancelado: false }
        timers.push(p)
        return {
          cancelar: () => {
            p.cancelado = true
          }
        }
      },
      spawn: (cmd, args) => {
        lanzamientos.push({ cmd, args })
        if (opciones.fallaSpawn) throw new Error('ENOENT')
        const f = procesoFalso()
        procesos.push(f)
        return f.proc
      }
    })
  }
  return banco
}

describe('rutaCloudflared', () => {
  it('prefiere Program Files (x86), que es donde lo deja el instalador de Cloudflare', () => {
    expect(rutaCloudflared(() => true)).toBe(X86)
  })

  it('cae a Program Files cuando no está la de x86', () => {
    expect(rutaCloudflared((p) => p === PF)).toBe(PF)
  })

  it('encuentra el enlace de WinGet', () => {
    const previo = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = 'C:\\Users\\yo\\AppData\\Local'
    try {
      const ruta = rutaCloudflared((p) => p.includes('WinGet'))
      expect(ruta).toBe('C:\\Users\\yo\\AppData\\Local\\Microsoft\\WinGet\\Links\\cloudflared.exe')
    } finally {
      if (previo === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = previo
    }
  })

  it('sin ninguna ruta devuelve el literal y confía en el PATH', () => {
    expect(rutaCloudflared(() => false)).toBe('cloudflared')
  })
})

describe('modo quick', () => {
  it('lanza cloudflared con la URL local y pasa a arrancando', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    expect(b.lanzamientos[0].args).toEqual([
      'tunnel',
      '--url',
      'http://127.0.0.1:43120',
      '--no-autoupdate'
    ])
    expect(b.t.estado).toEqual({ fase: 'arrancando', url: null })
    expect(b.estados).toEqual([{ fase: 'arrancando', url: null }])
  })

  it('detecta la URL en stderr, que es donde la escribe cloudflared', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('INF |  https://kind-blue-otter-42.trycloudflare.com  |\n')
    expect(b.t.estado).toEqual({ fase: 'activo', url: 'https://kind-blue-otter-42.trycloudflare.com' })
    expect(b.estados.map((e) => e.fase)).toEqual(['arrancando', 'activo'])
  })

  it('detecta la URL también en stdout', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().out('https://raro-pero-valido-7.trycloudflare.com\n')
    expect(b.t.estado.url).toBe('https://raro-pero-valido-7.trycloudflare.com')
    expect(b.t.estado.fase).toBe('activo')
  })

  it('reconstruye la URL partida entre dos trozos', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('tu url es https://mitad-')
    b.ultimo().err('y-mitad-9.trycloudflare.com\n')
    expect(b.t.estado.url).toBe('https://mitad-y-mitad-9.trycloudflare.com')
  })

  it('la URL detectada cancela la vigilancia del arranque', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('https://ok-1.trycloudflare.com\n')
    expect(b.vivos()).toHaveLength(0)
  })

  it('30 s sin URL: cae, mata el proceso y reintenta', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.disparar(30_000)
    expect(b.t.estado.fase).toBe('caido')
    expect(b.t.estado.detalle).toContain('30 s')
    expect(b.procesos[0].muertes).toBe(1)
    expect(b.vivos().map((x) => x.ms)).toEqual([5_000])
  })

  it('un proceso muerto da un detalle con el código de salida', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('failed to connect to the Cloudflare edge\n')
    b.avanzar(3_000)
    b.ultimo().exit(1)
    expect(b.t.estado.fase).toBe('caido')
    expect(b.t.estado.detalle).toContain('código 1')
    expect(b.t.estado.detalle).toContain('3 s')
    expect(b.t.estado.detalle).toContain('failed to connect to the Cloudflare edge')
  })

  it('si el spawn revienta, cae con el motivo en vez de tirar la excepción', () => {
    const b = montar({ fallaSpawn: true })
    expect(() => b.t.arrancar({ modo: 'quick', puerto: 43120 })).not.toThrow()
    expect(b.t.estado.fase).toBe('caido')
    expect(b.t.estado.detalle).toContain('ENOENT')
  })
})

describe('reintentos', () => {
  it('la espera crece 5, 10, 20, 40 y se queda en 60 s', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    const esperas: number[] = []
    for (let i = 0; i < 6; i++) {
      b.ultimo().exit(1)
      const p = b.vivos()
      expect(p).toHaveLength(1)
      esperas.push(p[0].ms)
      b.disparar(p[0].ms)
    }
    expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
    expect(b.lanzamientos).toHaveLength(7)
  })

  it('un arranque que llega a activo resetea la cuenta', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().exit(1)
    b.disparar(5_000)
    b.ultimo().exit(1)
    expect(b.vivos()[0].ms).toBe(10_000)
    b.disparar(10_000)
    b.ultimo().err('https://bueno-3.trycloudflare.com\n')
    expect(b.t.estado.fase).toBe('activo')
    b.ultimo().exit(0)
    expect(b.vivos().map((x) => x.ms)).toEqual([5_000])
  })

  it('el reintento vuelve a lanzar con los mismos argumentos', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().exit(null)
    b.disparar(5_000)
    expect(b.lanzamientos[1].args).toEqual(b.lanzamientos[0].args)
  })
})

describe('detener', () => {
  it('mata el proceso, deja fase apagado y no reintenta', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('https://vivo-1.trycloudflare.com\n')
    b.t.detener()
    expect(b.procesos[0].muertes).toBe(1)
    expect(b.t.estado).toEqual({ fase: 'apagado', url: null })
    expect(b.vivos()).toHaveLength(0)
  })

  it('el exit que llega después de detener no revive nada', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.t.detener()
    b.procesos[0].exit(1)
    expect(b.t.estado.fase).toBe('apagado')
    expect(b.vivos()).toHaveLength(0)
    expect(b.lanzamientos).toHaveLength(1)
  })

  it('cancela un reintento ya programado', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().exit(1)
    expect(b.vivos()).toHaveLength(1)
    b.t.detener()
    expect(b.vivos()).toHaveLength(0)
  })

  it('llamarlo dos veces no revienta ni repite el aviso', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.t.detener()
    expect(() => b.t.detener()).not.toThrow()
    expect(b.estados.filter((e) => e.fase === 'apagado')).toHaveLength(1)
  })
})

describe('modo dominio', () => {
  it('sin token no lanza nada y explica que falta el token', () => {
    const b = montar()
    b.t.arrancar({ modo: 'dominio', puerto: 43120, hostname: 'deck.ejemplo.com' })
    expect(b.lanzamientos).toHaveLength(0)
    expect(b.t.estado.fase).toBe('caido')
    expect(b.t.estado.detalle).toMatch(/token/i)
    expect(b.vivos()).toHaveLength(0)
  })

  it('sin hostname tampoco lanza: no habría URL que mostrar', () => {
    const b = montar()
    b.t.arrancar({ modo: 'dominio', puerto: 43120, token: 'eyJhIjoi' })
    expect(b.lanzamientos).toHaveLength(0)
    expect(b.t.estado.detalle).toMatch(/hostname/i)
  })

  it('con token lanza tunnel run y publica https://<hostname>', () => {
    const b = montar()
    b.t.arrancar({
      modo: 'dominio',
      puerto: 43120,
      token: 'eyJhIjoi',
      hostname: 'deck.ejemplo.com'
    })
    expect(b.lanzamientos[0].args).toEqual([
      'tunnel',
      'run',
      '--token',
      'eyJhIjoi',
      '--no-autoupdate'
    ])
    b.ultimo().err('INF Registered tunnel connection connIndex=0\n')
    expect(b.t.estado).toEqual({ fase: 'activo', url: 'https://deck.ejemplo.com' })
  })

  it('sin línea de conexión, sobrevivir al arranque ya cuenta como activo', () => {
    const b = montar()
    b.t.arrancar({
      modo: 'dominio',
      puerto: 43120,
      token: 'eyJhIjoi',
      hostname: 'deck.ejemplo.com'
    })
    b.disparar(30_000)
    expect(b.t.estado).toEqual({ fase: 'activo', url: 'https://deck.ejemplo.com' })
    expect(b.procesos[0].muertes).toBe(0)
  })

  it('una URL de trycloudflare no se cuela como URL del dominio', () => {
    const b = montar()
    b.t.arrancar({
      modo: 'dominio',
      puerto: 43120,
      token: 'eyJhIjoi',
      hostname: 'deck.ejemplo.com'
    })
    b.ultimo().err('INF https://otra-cosa-5.trycloudflare.com\n')
    expect(b.t.estado.fase).toBe('arrancando')
  })

  it('si el proceso muere, cae y reintenta como en quick', () => {
    const b = montar()
    b.t.arrancar({
      modo: 'dominio',
      puerto: 43120,
      token: 'eyJhIjoi',
      hostname: 'deck.ejemplo.com'
    })
    b.ultimo().exit(1)
    expect(b.t.estado.fase).toBe('caido')
    expect(b.vivos().map((x) => x.ms)).toEqual([5_000])
  })
})

describe('idempotencia y avisos', () => {
  it('arrancar sobre un túnel vivo no lanza un segundo proceso', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('https://uno-solo.trycloudflare.com\n')
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    expect(b.lanzamientos).toHaveLength(1)
    expect(b.procesos).toHaveLength(1)
  })

  it('el ruido del buffer de recepción no cambia la fase ni ensucia el detalle', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('WRN failed to sufficiently increase receive buffer size\n')
    expect(b.t.estado.fase).toBe('arrancando')
    expect(b.estados).toHaveLength(1)
    b.ultimo().exit(1)
    expect(b.t.estado.detalle).not.toContain('buffer')
  })

  it('no avisa dos veces del mismo estado exacto', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('https://repetida.trycloudflare.com\n')
    b.ultimo().err('https://repetida.trycloudflare.com\n')
    b.ultimo().out('https://repetida.trycloudflare.com\n')
    expect(b.estados.filter((e) => e.fase === 'activo')).toHaveLength(1)
  })

  it('cada transición avisa con una copia del estado', () => {
    const b = montar()
    b.t.arrancar({ modo: 'quick', puerto: 43120 })
    b.ultimo().err('https://copia.trycloudflare.com\n')
    b.ultimo().exit(1)
    b.t.detener()
    expect(b.estados.map((e) => e.fase)).toEqual(['arrancando', 'activo', 'caido', 'apagado'])
    expect(b.estados[1]).not.toBe(b.t.estado)
  })
})
