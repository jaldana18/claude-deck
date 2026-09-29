import { beforeEach, describe, expect, it } from 'vitest'
import { Auth, type AlmacenDispositivos } from '../src/main/remote/auth'
import type { RemoteDevice } from '../src/shared/types'

function almacenMemoria(): AlmacenDispositivos {
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

let reloj = 1_700_000_000_000
const ahora = (): number => reloj
let auth: Auth

beforeEach(() => {
  reloj = 1_700_000_000_000
  auth = new Auth(almacenMemoria(), ahora)
})

function emparejado(): string {
  const { codigo } = auth.nuevoCodigo()
  const r = auth.emparejar(codigo, 'Pixel')
  return r.token!
}

describe('emparejamiento', () => {
  it('el código usa un alfabeto sin caracteres confundibles', () => {
    const { codigo } = auth.nuevoCodigo()
    expect(codigo).toHaveLength(8)
    expect(codigo).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/)
    // los que de verdad se confunden al leerlos: O con 0, e I con 1
    expect(codigo).not.toMatch(/[O0I1]/)
  })

  it('dos códigos seguidos no se repiten', () => {
    const a = auth.nuevoCodigo().codigo
    const b = auth.nuevoCodigo().codigo
    expect(a).not.toBe(b)
  })

  it('pedir un código nuevo invalida el anterior: una sola puerta abierta', () => {
    const viejo = auth.nuevoCodigo().codigo
    auth.nuevoCodigo()
    expect(auth.emparejar(viejo, 'Pixel').ok).toBe(false)
  })

  it('entrega un token de 256 bits y guarda el dispositivo', () => {
    const { codigo } = auth.nuevoCodigo()
    const r = auth.emparejar(codigo, '  Pixel 9  ')

    expect(r.ok).toBe(true)
    expect(Buffer.from(r.token!, 'base64url')).toHaveLength(32)
    expect(r.device?.nombre).toBe('Pixel 9')
    expect(auth.dispositivos()).toHaveLength(1)
  })

  it('el código sirve una sola vez', () => {
    const { codigo } = auth.nuevoCodigo()
    expect(auth.emparejar(codigo, 'Pixel').ok).toBe(true)
    expect(auth.emparejar(codigo, 'Otro').ok).toBe(false)
    expect(auth.dispositivos()).toHaveLength(1)
  })

  it('el código caduca', () => {
    const { codigo } = auth.nuevoCodigo()
    reloj += 5 * 60_000 + 1
    expect(auth.codigoVigente).toBeNull()
    expect(auth.emparejar(codigo, 'Pixel').ok).toBe(false)
  })

  it('acepta el código en minúsculas y con espacios: se teclea a mano', () => {
    const { codigo } = auth.nuevoCodigo()
    expect(auth.emparejar(` ${codigo.toLowerCase()} `, 'Pixel').ok).toBe(true)
  })

  it('el error no distingue entre código equivocado y ventana cerrada', () => {
    const sinVentana = auth.emparejar('AAAAAAAA', 'x').error
    auth.nuevoCodigo()
    const equivocado = auth.emparejar('BBBBBBBB', 'x').error
    expect(sinVentana).toBe(equivocado)
  })
})

describe('verificación del token', () => {
  it('reconoce el dispositivo y anota cuándo se le vio', () => {
    const token = emparejado()
    reloj += 1000
    const d = auth.verificar(token)
    expect(d?.nombre).toBe('Pixel')
    expect(d?.ultimoVisto).toBe(reloj)
  })

  it('rechaza un token que no es de nadie, y la ausencia de token', () => {
    emparejado()
    expect(auth.verificar('no-soy-un-token')).toBeNull()
    expect(auth.verificar(undefined)).toBeNull()
    expect(auth.verificar('')).toBeNull()
  })

  it('revocar un dispositivo invalida su token al instante', () => {
    const token = emparejado()
    const d = auth.verificar(token)!
    auth.revocar(d.clientId)
    expect(auth.verificar(token)).toBeNull()
    expect(auth.dispositivos()).toEqual([])
  })

  it('revocar todos deja la casa vacía y sin ventana abierta', () => {
    const token = emparejado()
    auth.nuevoCodigo()
    auth.revocarTodos()
    expect(auth.verificar(token)).toBeNull()
    expect(auth.codigoVigente).toBeNull()
  })

  it('dos dispositivos conviven con tokens distintos', () => {
    const uno = emparejado()
    const otro = emparejado()
    expect(uno).not.toBe(otro)
    expect(auth.verificar(uno)?.clientId).not.toBe(auth.verificar(otro)?.clientId)
  })
})

describe('cierre por intentos fallidos', () => {
  it('diez fallos cierran la puerta y el token bueno tampoco pasa', () => {
    const token = emparejado()
    for (let i = 0; i < 10; i++) auth.verificar('malo')

    expect(auth.cerrada).toBeGreaterThan(0)
    expect(auth.verificar(token)).toBeNull()
  })

  it('el cierre se levanta solo, y el siguiente dura el doble', () => {
    const token = emparejado()
    for (let i = 0; i < 10; i++) auth.verificar('malo')
    reloj += 5 * 60_000 + 1
    expect(auth.cerrada).toBe(0)
    expect(auth.verificar(token)).not.toBeNull()

    // un acierto borra el historial: el siguiente cierre vuelve a ser el corto
    for (let i = 0; i < 10; i++) auth.verificar('malo')
    reloj += 5 * 60_000 + 1
    expect(auth.cerrada).toBe(0)
  })

  it('sin aciertos entre medias, cada ronda castiga más', () => {
    for (let i = 0; i < 10; i++) auth.verificar('malo')
    const primero = auth.cerrada - reloj
    reloj += primero + 1
    for (let i = 0; i < 10; i++) auth.verificar('malo')
    const segundo = auth.cerrada - reloj

    expect(segundo).toBe(primero * 2)
  })

  it('el tope del castigo es media hora: no se bloquea para siempre', () => {
    for (let ronda = 0; ronda < 10; ronda++) {
      for (let i = 0; i < 10; i++) auth.verificar('malo')
      const espera = auth.cerrada - reloj
      expect(espera).toBeLessThanOrEqual(30 * 60_000)
      reloj += espera + 1
    }
  })

  it('los fallos de emparejar y de token cuentan al mismo saco', () => {
    auth.nuevoCodigo()
    for (let i = 0; i < 5; i++) auth.emparejar('ZZZZZZZZ', 'x')
    for (let i = 0; i < 5; i++) auth.verificar('malo')
    expect(auth.cerrada).toBeGreaterThan(0)
  })

  it('con la puerta cerrada no se puede emparejar aunque el código sea bueno', () => {
    const { codigo } = auth.nuevoCodigo()
    for (let i = 0; i < 10; i++) auth.verificar('malo')
    expect(auth.emparejar(codigo, 'Pixel').ok).toBe(false)
  })
})
