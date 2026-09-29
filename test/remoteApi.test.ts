import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACCIONES_REMOTAS,
  EVENTOS_REMOTOS,
  VETADOS,
  accionRemota,
  eventoRemoto
} from '../src/main/remote/api'

/**
 * Canales registrados con `manejar`/`manejarEnvio`, que son los que quedan
 * invocables desde el acceso remoto. Uno permitido pero registrado con
 * `ipcMain` a secas compilaría igual y fallaría solo al usarlo desde el móvil.
 */
function canalesInvocables(): Set<string> {
  const src = readFileSync('src/main/index.ts', 'utf8')
  const found = new Set<string>()
  for (const m of src.matchAll(/manejar(?:Envio)?\(\s*'([^']+)'/g)) found.add(m[1])
  return found
}

/** Canales que el main emite hacia los clientes. */
function canalesEmitidos(): Set<string> {
  const found = new Set<string>()
  for (const f of ['index.ts', 'chatSession.ts', 'ptys.ts', 'status.ts', 'updater.ts', 'ownership.ts', 'store.ts', 'sessionTracker.ts', 'hookServer.ts']) {
    const src = readFileSync(`src/main/${f}`, 'utf8')
    for (const m of src.matchAll(/send\(\s*'([a-z][a-z:-]*)'/g)) found.add(m[1])
  }
  return found
}

describe('superficie remota', () => {
  it('ninguna acción vetada está permitida', () => {
    const permitidos = ACCIONES_REMOTAS.map((a) => a.canal)
    const colados = Object.keys(VETADOS).filter((c) => permitidos.includes(c))
    expect(colados).toEqual([])
    for (const c of Object.keys(VETADOS)) expect(accionRemota(c)).toBeNull()
  })

  it('ningún evento vetado se reenvía', () => {
    for (const c of Object.keys(VETADOS)) expect(eventoRemoto(c)).toBe(false)
    // el terminal entero queda fuera: está fuera del alcance acordado
    for (const c of ['pty:data', 'pty:exit', 'logs:data']) expect(eventoRemoto(c)).toBe(false)
    // y el ciclo de actualización es cosa del PC
    for (const c of ['update:available', 'update:progress']) expect(eventoRemoto(c)).toBe(false)
  })

  it('cada acción permitida está registrada como invocable en el main', () => {
    const reales = canalesInvocables()
    const fantasmas = ACCIONES_REMOTAS.filter((a) => !a.interna && !reales.has(a.canal))
    expect(fantasmas.map((a) => a.canal)).toEqual([])
  })

  it('no hay canales invocables que nadie haya autorizado', () => {
    const sobrantes = [...canalesInvocables()].filter((c) => !accionRemota(c))
    expect(sobrantes).toEqual([])
  })

  it('las acciones internas no son canales del main: las resuelve el gateway', () => {
    const reales = canalesInvocables()
    for (const a of ACCIONES_REMOTAS.filter((x) => x.interna)) {
      expect(reales.has(a.canal)).toBe(false)
    }
  })

  it('cada evento permitido lo emite alguien', () => {
    const reales = canalesEmitidos()
    expect(EVENTOS_REMOTOS.filter((c) => !reales.has(c))).toEqual([])
  })

  it('un canal desconocido no se permite por omisión', () => {
    expect(accionRemota('fs:rm')).toBeNull()
    expect(accionRemota('')).toBeNull()
    expect(eventoRemoto('cualquier:cosa')).toBe(false)
  })

  it('enviar y aprobar exigen el control; reclamarlo no', () => {
    for (const c of ['chat:send', 'chat:permission-response', 'chat:question-response', 'chat:interrupt']) {
      expect(accionRemota(c)?.control).toBe(true)
    }
    // si reclamar exigiera el control, el relevo sería imposible
    expect(accionRemota('chat:claim')?.control).toBe(false)
  })

  it('leer nunca exige el control: los dos lados ven todo en vivo', () => {
    for (const c of ['chat:snapshot', 'chat:snapshotAll', 'chat:history', 'tabs:list']) {
      expect(accionRemota(c)?.control).toBe(false)
    }
  })

  it('lo que recibe una ruta va confinado, y abrir pestaña solo abre chats', () => {
    expect(accionRemota('fs:tree')?.restricciones).toContain('confinar-raiz')
    expect(accionRemota('chats:open')?.restricciones).toContain('confinar-raiz')
    expect(accionRemota('tabs:create')?.restricciones).toEqual(
      expect.arrayContaining(['confinar-raiz', 'forzar-chat'])
    )
  })

  it('no hay acciones duplicadas', () => {
    const canales = ACCIONES_REMOTAS.map((a) => a.canal)
    expect(new Set(canales).size).toBe(canales.length)
    expect(new Set(EVENTOS_REMOTOS).size).toBe(EVENTOS_REMOTOS.length)
  })
})
