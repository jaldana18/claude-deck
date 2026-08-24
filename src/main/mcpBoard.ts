import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { BoardData, BoardItem } from '../shared/types'
import { extractJsonBlock } from '../shared/parse'

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * Board del sprint reutilizando el MCP de azure-devops que el usuario ya tiene
 * configurado en Claude Code (~/.claude.json o .mcp.json del proyecto): la app
 * lanza el mismo server por stdio y lo consulta directamente.
 */

function isAzureServer(name: string, cfg: unknown): boolean {
  if (name.toLowerCase().includes('azure')) return true
  const args = (cfg as { args?: string[] })?.args ?? []
  return args.some((a) => String(a).includes('azure-devops'))
}

function pickAzure(servers: Record<string, unknown> | undefined): McpServerConfig | null {
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    if (isAzureServer(name, cfg)) return cfg as McpServerConfig
  }
  return null
}

/**
 * Busca el MCP de azure-devops en TODOS los alcances donde Claude Code puede
 * guardarlo: .mcp.json del proyecto, nivel usuario de ~/.claude.json, y el
 * alcance "local" (por proyecto DENTRO de ~/.claude.json → projects[ruta].mcpServers,
 * que es el default de `claude mcp add` y donde suele quedar en los equipos).
 */
function readAzureMcpConfig(cwd: string): McpServerConfig | null {
  // 1. .mcp.json del proyecto
  try {
    const projFile = join(cwd, '.mcp.json')
    if (existsSync(projFile)) {
      const found = pickAzure(JSON.parse(readFileSync(projFile, 'utf8')).mcpServers)
      if (found) return found
    }
  } catch {
    /* seguir */
  }
  try {
    const file = join(homedir(), '.claude.json')
    if (!existsSync(file)) return null
    const json = JSON.parse(readFileSync(file, 'utf8'))
    // 2. nivel usuario (global)
    const global = pickAzure(json.mcpServers)
    if (global) return global
    // 3. alcance local: projects["<ruta>"].mcpServers — primero la ruta del
    //    chat actual, luego cualquier proyecto que lo tenga
    const projects = (json.projects ?? {}) as Record<string, { mcpServers?: Record<string, unknown> }>
    const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
    for (const [path, entry] of Object.entries(projects)) {
      if (norm(path) === norm(cwd)) {
        const found = pickAzure(entry.mcpServers)
        if (found) return found
      }
    }
    for (const entry of Object.values(projects)) {
      const found = pickAzure(entry.mcpServers)
      if (found) return found
    }
  } catch {
    /* sin config */
  }
  return null
}

let client: Client | null = null
let clientKey = ''

/** Caché de la config MCP por carpeta (TTL 60 s): antes se leían y parseaban
 *  .mcp.json y ~/.claude.json —que puede pesar decenas de MB— en cada llamada
 *  al board, a builds y a PRs, por cada pestaña. */
const cfgCache = new Map<string, { at: number; cfg: ReturnType<typeof readAzureMcpConfig> }>()
function cachedAzureConfig(cwd: string): ReturnType<typeof readAzureMcpConfig> {
  const hit = cfgCache.get(cwd)
  if (hit && Date.now() - hit.at < 60_000) return hit.cfg
  const cfg = readAzureMcpConfig(cwd)
  cfgCache.set(cwd, { at: Date.now(), cfg })
  return cfg
}

async function getClient(cwd: string): Promise<Client> {
  const cfg = cachedAzureConfig(cwd)
  if (!cfg) {
    throw new Error(
      'No se encontró el MCP de azure-devops en ~/.claude.json ni en el .mcp.json del proyecto.'
    )
  }
  const key = JSON.stringify(cfg)
  if (client && clientKey === key) return client

  await closeClient()
  // En Windows, npx/npm son .cmd: hay que lanzarlos a través de cmd /c
  const isCmdShim = ['npx', 'npm', 'pnpm', 'yarn'].includes(cfg.command)
  const transport = new StdioClientTransport({
    command: isCmdShim ? 'cmd.exe' : cfg.command,
    args: isCmdShim ? ['/c', cfg.command, ...(cfg.args ?? [])] : (cfg.args ?? []),
    env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) }
  })
  const c = new Client({ name: 'claude-deck', version: '1.0.0' })
  await c.connect(transport)
  client = c
  clientKey = key
  return c
}

export async function closeClient(): Promise<void> {
  try {
    await client?.close()
  } catch {
    /* ignore */
  }
  client = null
  clientKey = ''
}

/** Extrae el JSON del contenido de una respuesta MCP (viene como bloques text) */
function parseToolResult(res: unknown): unknown {
  const r = res as { isError?: boolean; content?: { type?: string; text?: string }[] }
  const text = r.content
    ?.filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
  // Los errores del server llegan como isError + texto: propagarlos, no tragarlos
  if (r.isError) {
    throw new Error(text?.slice(0, 400) || 'El MCP devolvió un error sin detalle')
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // El server suele anteponer un preámbulo ("Project: X, Team: Y\n[...]"):
    // extraer el primer bloque JSON del texto (ver shared/parse + tests)
    const block = extractJsonBlock(text)
    if (block) {
      try {
        return JSON.parse(block)
      } catch {
        /* sigue como texto */
      }
    }
    return text
  }
}

/** Recolecta ids de work items de una respuesta con forma variable */
function collectWorkItemIds(data: unknown): number[] {
  const ids = new Set<number>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const obj = node as Record<string, unknown>
    if (typeof obj.id === 'number' && (obj.url === undefined || String(obj.url).includes('workItems'))) {
      ids.add(obj.id)
    }
    Object.values(obj).forEach(visit)
  }
  visit(data)
  return [...ids]
}

/**
 * Normaliza respuestas MCP de forma variable: array directo, {value:[]},
 * {iterations:[]}, u objeto con cualquier propiedad-array. Un objeto suelto
 * con id se trata como fila única.
 */
function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['value', 'iterations', 'teamIterations', 'workItems', 'items']) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[]
  }
  // cualquier propiedad que sea un array de objetos
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      return v as Record<string, unknown>[]
    }
  }
  // objeto único con pinta de fila
  if ('id' in obj || 'name' in obj) return [obj]
  return []
}

/** Proyectos de la organización (para el selector del widget) */
/** Llamada genérica a una tool del MCP azure-devops (para pipelines/PRs) */
export async function callAzureTool(
  cwd: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const c = await getClient(cwd)
  return parseToolResult(await c.callTool({ name, arguments: args }))
}

export async function listProjects(cwd: string): Promise<{ id?: string; name: string }[]> {
  const c = await getClient(cwd)
  const res = parseToolResult(await c.callTool({ name: 'core_list_projects', arguments: {} }))
  return asRows(res)
    .map((r) => ({ id: r.id as string | undefined, name: String(r.name ?? '') }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Equipos de un proyecto */
export async function listTeams(cwd: string, project: string): Promise<{ name: string }[]> {
  const c = await getClient(cwd)
  const res = parseToolResult(
    await c.callTool({ name: 'core_list_project_teams', arguments: { project } })
  )
  return asRows(res)
    .map((r) => ({ name: String(r.name ?? '') }))
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Iteraciones (sprints) de un equipo, con marca de cuál es la actual */
export async function listIterations(
  cwd: string,
  project: string,
  team: string
): Promise<{ id: string; name: string; timeFrame?: string }[]> {
  const c = await getClient(cwd)
  const res = parseToolResult(
    await c.callTool({ name: 'work', arguments: { action: 'list_team_iterations', project, team } })
  )
  return asRows(res)
    .map((r) => {
      const attrs = r.attributes as { timeFrame?: string } | undefined
      return {
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        timeFrame: attrs?.timeFrame
      }
    })
    .filter((i) => i.id && i.name)
}

export async function getSprintBoard(
  cwd: string,
  project: string,
  team: string,
  iterationId?: string
): Promise<BoardData> {
  try {
    const c = await getClient(cwd)

    // 1. Iteración: la elegida en el widget, o la actual del equipo
    let current: {
      id?: string
      name?: string
      attributes?: { startDate?: string; finishDate?: string }
    }
    if (iterationId) {
      current = { id: iterationId }
      const all = await listIterations(cwd, project, team).catch(() => [])
      const found = all.find((i) => i.id === iterationId)
      if (found) current.name = found.name
    } else {
      const iterRes = parseToolResult(
        await c.callTool({
          name: 'work',
          arguments: { action: 'list_team_iterations', project, team, timeframe: 'current' }
        })
      )
      current = (asRows(iterRes)[0] ?? {}) as typeof current
      if (!current?.id) {
        // fallback: listar todas y elegir la marcada como actual
        const all = await listIterations(cwd, project, team).catch(() => [])
        const cur = all.find((i) => i.timeFrame === 'current') ?? all.at(-1)
        if (cur) current = { id: cur.id, name: cur.name }
        else {
          return {
            ok: false,
            items: [],
            error: `No se encontró iteración actual. Respuesta del MCP: ${JSON.stringify(iterRes).slice(0, 300)} — elige el sprint manualmente en la configuración del widget (⚙ en el título).`
          }
        }
      }
    }
    if (!current?.id) {
      return { ok: false, items: [], error: 'No hay una iteración actual para ese proyecto/equipo.' }
    }

    // 2. Work items de la iteración
    const listRes = parseToolResult(
      await c.callTool({
        name: 'wit_work_item',
        arguments: { action: 'list_for_iteration', project, team, iterationId: current.id }
      })
    )
    const ids = collectWorkItemIds(listRes)
    if (ids.length === 0) {
      return {
        ok: true,
        sprintName: current.name,
        sprintDates: formatDates(current.attributes),
        items: []
      }
    }

    // 3. Detalle de los items para las tarjetas — en lotes de 100 porque
    //    get_batch falla con sprints grandes (el tope de la API es 200)
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const batchRes = parseToolResult(
        await c.callTool({
          name: 'wit_work_item',
          arguments: {
            action: 'get_batch',
            project,
            ids: ids.slice(i, i + 100),
            fields: [
              'System.Id',
              'System.Title',
              'System.State',
              'System.WorkItemType',
              'System.AssignedTo',
              'Microsoft.VSTS.Scheduling.StoryPoints'
            ]
          }
        })
      ) as Record<string, unknown> | Record<string, unknown>[] | null
      rows.push(
        ...(Array.isArray(batchRes)
          ? batchRes
          : ((batchRes as Record<string, unknown>)?.value as Record<string, unknown>[] | undefined) ?? [])
      )
    }

    const items: BoardItem[] = rows
      .map((row) => {
        const f = (row.fields ?? row) as Record<string, unknown>
        const assigned = f['System.AssignedTo'] as { displayName?: string } | string | undefined
        return {
          id: Number(row.id ?? f['System.Id'] ?? 0),
          title: String(f['System.Title'] ?? ''),
          state: String(f['System.State'] ?? 'Sin estado'),
          type: String(f['System.WorkItemType'] ?? ''),
          assignedTo:
            typeof assigned === 'string'
              ? assigned
              : (assigned?.displayName ?? 'Sin asignar'),
          points: (f['Microsoft.VSTS.Scheduling.StoryPoints'] as number | undefined) ?? undefined
        }
      })
      .filter((i) => i.id > 0 && i.title)

    return {
      ok: true,
      sprintName: current.name,
      sprintDates: formatDates(current.attributes),
      items
    }
  } catch (err) {
    await closeClient()
    return { ok: false, items: [], error: String(err).slice(0, 500) }
  }
}

function formatDates(attrs?: { startDate?: string; finishDate?: string }): string | undefined {
  if (!attrs?.startDate) return undefined
  const fmt = (d: string): string => new Date(d).toLocaleDateString()
  return `${fmt(attrs.startDate)} → ${attrs.finishDate ? fmt(attrs.finishDate) : '?'}`
}
