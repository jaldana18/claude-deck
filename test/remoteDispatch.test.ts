import { describe, expect, it, vi } from 'vitest'
import { Dispatcher, dentroDeRaices } from '../src/main/remote/dispatch'

function montar(
  opciones: {
    control?: boolean
    raices?: string[]
    invocar?: (canal: string, args: unknown) => unknown
  } = {}
): { d: Dispatcher; llamadas: [string, unknown][] } {
  const llamadas: [string, unknown][] = []
  const d = new Dispatcher({
    invocar: (canal, args) => {
      llamadas.push([canal, args])
      return opciones.invocar ? opciones.invocar(canal, args) : 'ok'
    },
    puedeActuar: () => opciones.control ?? true,
    raices: () => opciones.raices ?? ['C:\\proyectos']
  })
  return { d, llamadas }
}

describe('dentroDeRaices', () => {
  it('acepta la raíz y lo que hay debajo', () => {
    expect(dentroDeRaices('C:\\proyectos', ['C:\\proyectos'])).toBe(true)
    expect(dentroDeRaices('C:\\proyectos\\api\\src', ['C:\\proyectos'])).toBe(true)
  })

  it('no confunde un hermano con un hijo', () => {
    expect(dentroDeRaices('C:\\proyectos-secretos', ['C:\\proyectos'])).toBe(false)
  })

  it('un .. intermedio no sirve para salirse', () => {
    expect(dentroDeRaices('C:\\proyectos\\..\\Windows', ['C:\\proyectos'])).toBe(false)
    expect(dentroDeRaices('C:\\proyectos\\api\\..\\web', ['C:\\proyectos'])).toBe(true)
  })

  it('en Windows da igual cómo se escriba', () => {
    expect(dentroDeRaices('c:\\PROYECTOS\\api', ['C:\\proyectos'])).toBe(true)
  })

  it('una ruta relativa nunca pasa: se resolvería contra el cwd del proceso', () => {
    expect(dentroDeRaices('proyectos\\api', ['C:\\proyectos'])).toBe(false)
    expect(dentroDeRaices('..\\..\\Windows', ['C:\\proyectos'])).toBe(false)
  })

  it('sin raíces no hay nada dentro', () => {
    expect(dentroDeRaices('C:\\proyectos', [])).toBe(false)
  })
})

describe('Dispatcher', () => {
  it('deja pasar una lectura permitida', async () => {
    const { d, llamadas } = montar()
    await expect(d.atender('chat:snapshot', 'tab-1', 'movil')).resolves.toEqual({
      ok: true,
      data: 'ok'
    })
    expect(llamadas).toEqual([['chat:snapshot', 'tab-1']])
  })

  it('un canal que no está en la lista no llega al main', async () => {
    const { d, llamadas } = montar()
    const r = await d.atender('pty:input', { paneId: 'p', data: 'rm -rf /\r' }, 'movil')
    expect(r).toMatchObject({ ok: false, motivo: 'no-permitido' })
    expect(llamadas).toEqual([])
  })

  it('un canal inventado responde igual que uno vetado', async () => {
    const { d } = montar()
    const inventado = await d.atender('fs:borrarTodo', {}, 'movil')
    const vetado = await d.atender('logs:spawn', {}, 'movil')
    expect(inventado.error).toBe(vetado.error)
  })

  it('sin el control no se envía ni se aprueba', async () => {
    const { d, llamadas } = montar({ control: false })
    for (const canal of ['chat:send', 'chat:permission-response', 'chat:interrupt']) {
      const r = await d.atender(canal, { tabId: 'tab-1' }, 'movil')
      expect(r).toMatchObject({ ok: false, motivo: 'sin-control' })
    }
    expect(llamadas).toEqual([])
  })

  it('sin el control todavía se puede leer y reclamarlo', async () => {
    const { d } = montar({ control: false })
    await expect(d.atender('chat:snapshotAll', undefined, 'movil')).resolves.toMatchObject({
      ok: true
    })
    await expect(d.atender('chat:claim', 'tab-1', 'movil')).resolves.toMatchObject({ ok: true })
  })

  it('una acción con control y sin conversación no se ejecuta', async () => {
    const { d, llamadas } = montar()
    const r = await d.atender('chat:send', { text: 'hola' }, 'movil')
    expect(r).toMatchObject({ ok: false, motivo: 'fallo' })
    expect(llamadas).toEqual([])
  })

  it('el tabId se saca igual de un string suelto que de un objeto', async () => {
    const puede = vi.fn(() => true)
    const d = new Dispatcher({ invocar: () => 'ok', puedeActuar: puede, raices: () => [] })
    await d.atender('chat:interrupt', 'tab-9', 'movil')
    await d.atender('chat:send', { tabId: 'tab-7', text: 'x' }, 'movil')
    expect(puede.mock.calls).toEqual([
      ['tab-9', 'movil'],
      ['tab-7', 'movil']
    ])
  })

  it('una carpeta fuera de las raíces no se lista', async () => {
    const { d, llamadas } = montar()
    const r = await d.atender('fs:tree', { dir: 'C:\\Users\\jaldana\\.ssh' }, 'movil')
    expect(r).toMatchObject({ ok: false, motivo: 'ruta-fuera' })
    expect(llamadas).toEqual([])
  })

  it('una carpeta dentro de las raíces sí', async () => {
    const { d, llamadas } = montar()
    await expect(
      d.atender('fs:tree', { dir: 'C:\\proyectos\\api' }, 'movil')
    ).resolves.toMatchObject({ ok: true })
    expect(llamadas).toHaveLength(1)
  })

  it('el historial se confina aunque la ruta venga como argumento suelto', async () => {
    const { d, llamadas } = montar()
    const r = await d.atender('chat:sessions', 'C:\\Users\\jaldana', 'movil')
    expect(r).toMatchObject({ ok: false, motivo: 'ruta-fuera' })
    await expect(d.atender('chat:sessions', 'C:\\proyectos\\api', 'movil')).resolves.toMatchObject({
      ok: true
    })
    expect(llamadas).toHaveLength(1)
  })

  it('leer o reanudar una conversación guardada también se confina', async () => {
    const { d } = montar()
    for (const canal of ['chats:transcript', 'chats:open']) {
      const r = await d.atender(
        canal,
        { cwd: 'C:\\Windows', sessionId: '6f1a2b3c-0000-4444-8888-aaaabbbbcccc' },
        'movil'
      )
      expect(r).toMatchObject({ ok: false, motivo: 'ruta-fuera' })
    }
  })

  // El id acaba siendo el nombre de un archivo: un `..` dentro sacaría la
  // lectura de la carpeta del proyecto, ya validada.
  it('un id de conversación que no es un id no llega al disco', async () => {
    const { d, llamadas } = montar()
    for (const id of ['../../../otro-proyecto/sesion', 'a', '']) {
      const r = await d.atender(
        'chats:transcript',
        { cwd: 'C:\\proyectos\\api', sessionId: id },
        'movil'
      )
      expect(r.ok).toBe(false)
    }
    await expect(
      d.atender(
        'chats:transcript',
        { cwd: 'C:\\proyectos\\api', sessionId: '6f1a2b3c-0000-4444-8888-aaaabbbbcccc' },
        'movil'
      )
    ).resolves.toMatchObject({ ok: true })
    expect(llamadas).toHaveLength(1)
  })

  it('el cwd de una pestaña nueva también se confina', async () => {
    const { d } = montar()
    await expect(
      d.atender('tabs:create', { cwd: 'C:\\Windows\\System32', mode: 'chat' }, 'movil')
    ).resolves.toMatchObject({ ok: false, motivo: 'ruta-fuera' })
  })

  it('abrir pestaña desde fuera siempre abre un chat, no un terminal', async () => {
    const { d, llamadas } = montar()
    await d.atender(
      'tabs:create',
      { cwd: 'C:\\proyectos\\api', mode: 'terminal', cli: 'claude', cliCommand: 'cmd.exe' },
      'movil'
    )
    expect(llamadas[0][1]).toEqual({ cwd: 'C:\\proyectos\\api', mode: 'chat' })
  })

  it('un fallo del main se devuelve como fallo, no como permiso denegado', async () => {
    const { d } = montar({
      invocar: () => {
        throw new Error('la sesión no existe')
      }
    })
    await expect(d.atender('chat:snapshot', 'tab-1', 'movil')).resolves.toEqual({
      ok: false,
      motivo: 'fallo',
      error: 'la sesión no existe'
    })
  })

  it('espera el resultado asíncrono del main', async () => {
    const { d } = montar({ invocar: async () => ['un', 'mensaje'] })
    await expect(d.atender('chat:history', 'tab-1', 'movil')).resolves.toEqual({
      ok: true,
      data: ['un', 'mensaje']
    })
  })
})
