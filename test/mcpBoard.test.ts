import { describe, expect, it, vi } from 'vitest'

/**
 * Bug real (v0.34): al arrancar la app todos los widgets MCP de todas las
 * pestañas pedían conexión a la vez; cada getClient cerraba la conexión que
 * otro acababa de crear y lanzaba su propio server npx. Quedaban procesos
 * huérfanos, las llamadas en vuelo morían y los widgets se quedaban en
 * «Consultando…» para siempre. Estos tests cubren la conexión única
 * compartida y la reconexión automática cuando la conexión está muerta.
 */

// --- dobles de los módulos externos ---

interface Comportamiento {
  connectLento: boolean
  callTool: (esta: FakeClient, args: { name: string }) => Promise<unknown>
}

const conexiones: FakeClient[] = []
const comportamiento: Comportamiento = {
  connectLento: false,
  callTool: async () => textoJson('[]')
}

/** Respuesta MCP con un bloque de texto JSON, como la devuelve el server real */
function textoJson(json: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: json }] }
}

class FakeClient {
  cerrado = false
  constructor() {
    conexiones.push(this)
  }
  async connect(): Promise<void> {
    if (comportamiento.connectLento) await new Promise((r) => setImmediate(r))
  }
  async close(): Promise<void> {
    this.cerrado = true
  }
  callTool(args: { name: string }): Promise<unknown> {
    return comportamiento.callTool(this, args)
  }
}

class FakeTransport {
  async close(): Promise<void> {
    /* nada */
  }
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: FakeClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: FakeTransport }))
vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () =>
    JSON.stringify({
      mcpServers: { 'azure-devops': { command: 'npx', args: ['-y', '@azure-devops/mcp', 'org'] } }
    })
}))

/** Módulo fresco por test: el cliente compartido es estado del módulo */
async function cargar(): Promise<typeof import('../src/main/mcpBoard')> {
  vi.resetModules()
  conexiones.length = 0
  comportamiento.connectLento = false
  comportamiento.callTool = async () => textoJson('[]')
  return import('../src/main/mcpBoard')
}

describe('mcpBoard: conexión única compartida', () => {
  it('una estampida de widgets concurrentes comparte UNA conexión', async () => {
    const { listProjects } = await cargar()
    comportamiento.connectLento = true
    comportamiento.callTool = async () => textoJson('[{"id":"1","name":"Proyecto"}]')

    const resultados = await Promise.all([
      listProjects('C:\\proyecto'),
      listProjects('C:\\proyecto'),
      listProjects('C:\\proyecto'),
      listProjects('C:\\proyecto'),
      listProjects('C:\\proyecto')
    ])

    expect(conexiones.length).toBe(1)
    for (const r of resultados) expect(r).toEqual([{ id: '1', name: 'Proyecto' }])
  })

  it('las llamadas siguientes reusan la conexión ya abierta', async () => {
    const { listProjects, listTeams } = await cargar()
    comportamiento.callTool = async () => textoJson('[{"name":"X"}]')

    await listProjects('C:\\proyecto')
    await listTeams('C:\\proyecto', 'X')
    expect(conexiones.length).toBe(1)
  })
})

describe('mcpBoard: reconexión cuando la conexión murió', () => {
  it('reconecta y reintenta una vez si el transporte estaba cerrado', async () => {
    const { listProjects } = await cargar()
    comportamiento.callTool = async (esta) => {
      if (esta === conexiones[0]) throw new Error('Connection closed')
      return textoJson('[{"name":"Recuperado"}]')
    }

    const r = await listProjects('C:\\proyecto')
    expect(r).toEqual([{ name: 'Recuperado' }])
    expect(conexiones.length).toBe(2)
    expect(conexiones[0].cerrado).toBe(true)
  })

  it('un error normal del server NO tumba la conexión compartida', async () => {
    const { listProjects } = await cargar()
    let llamadas = 0
    comportamiento.callTool = async () => {
      llamadas++
      if (llamadas === 1) throw new Error('VS402337: iteración inexistente')
      return textoJson('[{"name":"Sigue viva"}]')
    }

    await expect(listProjects('C:\\proyecto')).rejects.toThrow('VS402337')
    // la siguiente llamada reusa el mismo cliente: no hubo reconexión
    const r = await listProjects('C:\\proyecto')
    expect(r).toEqual([{ name: 'Sigue viva' }])
    expect(conexiones.length).toBe(1)
    expect(conexiones[0].cerrado).toBe(false)
  })
})
