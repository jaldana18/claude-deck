import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { dialog } from 'electron'
import type { ConfigScope, StoreResult } from '../shared/types'
import { backup, readJsonOr, writeJson } from './jsonEdit'

/**
 * «Tienda» de Claude Deck: agregar servidores MCP, importar agentes y skills
 * (desde archivo, carpeta o URL) e instalar plugins de Claude Code vía su CLI.
 * Todo escribe en los mismos sitios que usa Claude Code, así que lo instalado
 * aquí funciona igual en la TUI de la consola.
 */

function claudeDir(scope: ConfigScope, cwd: string): string {
  return scope === 'user' ? join(homedir(), '.claude') : join(cwd, '.claude')
}

// ---------- MCP ----------

/**
 * Agrega un servidor MCP en el mismo formato que `claude mcp add`:
 * proyecto → <cwd>/.mcp.json · usuario → ~/.claude.json (clave mcpServers).
 */
export function addMcpServer(args: {
  scope: ConfigScope
  cwd: string
  name: string
  command: string
  argsList: string[]
  env: Record<string, string>
}): StoreResult {
  const name = args.name.trim()
  if (!name || !args.command.trim()) {
    return { ok: false, message: 'Faltan el nombre o el comando del servidor.' }
  }
  const file =
    args.scope === 'project' ? join(args.cwd, '.mcp.json') : join(homedir(), '.claude.json')
  try {
    const data = readJsonOr(file, {})
    data.mcpServers = data.mcpServers ?? {}
    if (data.mcpServers[name]) {
      return { ok: false, message: `Ya existe un servidor MCP llamado «${name}» en ese alcance.` }
    }
    backup(file)
    data.mcpServers[name] = {
      command: args.command.trim(),
      ...(args.argsList.length ? { args: args.argsList } : {}),
      ...(Object.keys(args.env).length ? { env: args.env } : {})
    }
    writeJson(file, data)
    return {
      ok: true,
      message: `Servidor «${name}» agregado (${args.scope === 'project' ? '.mcp.json del proyecto' : '~/.claude.json'}). Aplica en sesiones nuevas.`
    }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

// ---------- Importar agentes / skills ----------

/** Importa agentes: diálogo de archivos .md → se copian a la carpeta agents/ */
export async function importAgents(scope: ConfigScope, cwd: string): Promise<StoreResult> {
  const r = await dialog.showOpenDialog({
    title: 'Importar agentes (.md)',
    filters: [{ name: 'Agentes de Claude Code', extensions: ['md'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (r.canceled || r.filePaths.length === 0) return { ok: false, message: '' }
  const dir = join(claudeDir(scope, cwd), 'agents')
  mkdirSync(dir, { recursive: true })
  const names: string[] = []
  for (const f of r.filePaths) {
    const dest = join(dir, basename(f))
    if (existsSync(dest)) return { ok: false, message: `Ya existe ${basename(f)} en ${dir}.` }
    cpSync(f, dest)
    names.push(basename(f, '.md'))
  }
  return { ok: true, message: `Importado(s): ${names.join(', ')} → ${dir}` }
}

/** Importa una skill: diálogo de carpeta (debe contener SKILL.md) → skills/<nombre> */
export async function importSkill(scope: ConfigScope, cwd: string): Promise<StoreResult> {
  const r = await dialog.showOpenDialog({
    title: 'Importar skill (carpeta con SKILL.md)',
    properties: ['openDirectory']
  })
  if (r.canceled || r.filePaths.length === 0) return { ok: false, message: '' }
  const src = r.filePaths[0]
  if (!existsSync(join(src, 'SKILL.md'))) {
    return { ok: false, message: 'La carpeta elegida no contiene un SKILL.md.' }
  }
  const dest = join(claudeDir(scope, cwd), 'skills', basename(src))
  if (existsSync(dest)) return { ok: false, message: `Ya existe la skill «${basename(src)}».` }
  cpSync(src, dest, { recursive: true })
  return { ok: true, message: `Skill «${basename(src)}» importada → ${dest}` }
}

/**
 * Importa un agente o una skill desde una URL (p.ej. un .md en GitHub).
 * Los enlaces github.com/…/blob/… se convierten solos a raw.githubusercontent.
 */
export async function importFromUrl(args: {
  kind: 'agent' | 'skill'
  scope: ConfigScope
  cwd: string
  url: string
}): Promise<StoreResult> {
  let url = args.url.trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'URL inválida.' }
  url = url.replace(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//,
    'https://raw.githubusercontent.com/$1/$2/'
  )
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, message: `La descarga falló: HTTP ${res.status}` }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      return { ok: false, message: 'La URL devolvió HTML, no un .md — usa el enlace «raw».' }
    }
    const rawName = decodeURIComponent(url.split('/').filter(Boolean).at(-1) ?? 'importado.md')
    const mdName = rawName.endsWith('.md') ? rawName : `${rawName}.md`
    if (args.kind === 'agent') {
      const dir = join(claudeDir(args.scope, args.cwd), 'agents')
      mkdirSync(dir, { recursive: true })
      const dest = join(dir, mdName)
      if (existsSync(dest)) return { ok: false, message: `Ya existe ${mdName}.` }
      writeFileSync(dest, text, 'utf8')
      return { ok: true, message: `Agente descargado → ${dest}` }
    }
    // skill: se crea skills/<nombre>/SKILL.md con el contenido descargado
    const skillName = basename(mdName, '.md').replace(/^SKILL$/i, 'skill-importada')
    const dir = join(claudeDir(args.scope, args.cwd), 'skills', skillName)
    if (existsSync(dir)) return { ok: false, message: `Ya existe la skill «${skillName}».` }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text, 'utf8')
    return { ok: true, message: `Skill descargada → ${join(dir, 'SKILL.md')}` }
  } catch (err) {
    return { ok: false, message: `No se pudo descargar: ${err}` }
  }
}

// ---------- Plugins (CLI de Claude Code) ----------

const PLUGIN_SUBCOMMANDS = new Set(['install', 'uninstall', 'enable', 'disable', 'list', 'marketplace'])

/**
 * Corre `claude plugin …` de forma headless y devuelve la salida. Solo se
 * permiten los subcomandos de gestión (nada de eval/init arbitrarios).
 * shell:true resuelve el shim claude.cmd/claude.exe en Windows (igual que el
 * validador headless).
 */
export function runPluginCommand(argsList: string[], cwd: string): Promise<StoreResult> {
  if (argsList.length === 0 || !PLUGIN_SUBCOMMANDS.has(argsList[0])) {
    return Promise.resolve({ ok: false, message: 'Subcomando de plugin no permitido.' })
  }
  return new Promise((resolve) => {
    const child = spawn('claude', ['plugin', ...argsList], {
      cwd,
      shell: true,
      windowsHide: true
    })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, message: `Tiempo agotado (2 min).\n${out.slice(-2000)}` })
    }, 120_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, message: `No se pudo ejecutar el CLI de claude: ${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, message: out.trim().slice(0, 4000) || `(sin salida, código ${code})` })
    })
  })
}
