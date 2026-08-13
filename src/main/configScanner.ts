import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type {
  ClaudeMdInfo,
  ConfigItem,
  ConfigScope,
  HookItem,
  ProjectConfig
} from '../shared/types'
import { DECK_HOOK_MARKER } from '../shared/constants'

export const DISABLED_SUFFIX = '.deck-disabled'

function userClaudeDir(): string {
  return join(homedir(), '.claude')
}

function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim()
  }
  return out
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`JSON inválido en ${file}:`, err)
  }
  return null
}

/**
 * Escaneo RECURSIVO de archivos .md (agentes y slash commands): los equipos
 * suelen organizarlos en subcarpetas y Claude Code las soporta.
 */
function scanMdItems(
  dir: string,
  scope: ConfigScope,
  kind: 'agent' | 'command',
  depth = 0
): ConfigItem[] {
  const items: ConfigItem[] = []
  if (!existsSync(dir) || depth > 3) return items
  for (const f of readdirSync(dir)) {
    const full = join(dir, f)
    try {
      if (statSync(full).isDirectory()) {
        items.push(...scanMdItems(full, scope, kind, depth + 1))
        continue
      }
    } catch {
      continue
    }
    const enabled = f.endsWith('.md')
    const disabled = f.endsWith(`.md${DISABLED_SUFFIX}`)
    if (!enabled && !disabled) continue
    let description = ''
    let name = basename(f, disabled ? `.md${DISABLED_SUFFIX}` : '.md')
    try {
      const fm = frontmatter(readFileSync(full, 'utf8'))
      if (fm.name) name = fm.name
      description = fm.description ?? ''
    } catch {
      /* ignore */
    }
    items.push({
      kind,
      name: kind === 'command' ? `/${name}` : name,
      description,
      scope,
      enabled,
      path: full
    })
  }
  return items
}

function scanAgents(dir: string, scope: ConfigScope): ConfigItem[] {
  return scanMdItems(dir, scope, 'agent')
}

function scanSkills(dir: string, scope: ConfigScope): ConfigItem[] {
  const items: ConfigItem[] = []
  if (!existsSync(dir)) return items
  for (const entry of readdirSync(dir)) {
    const skillDir = join(dir, entry)
    try {
      if (!statSync(skillDir).isDirectory()) continue
    } catch {
      continue
    }
    const active = join(skillDir, 'SKILL.md')
    const inactive = join(skillDir, `SKILL.md${DISABLED_SUFFIX}`)
    const enabled = existsSync(active)
    if (!enabled && !existsSync(inactive)) continue
    let description = ''
    try {
      const fm = frontmatter(readFileSync(enabled ? active : inactive, 'utf8'))
      description = fm.description ?? ''
    } catch {
      /* ignore */
    }
    items.push({
      kind: 'skill',
      name: entry,
      description,
      scope,
      enabled,
      path: enabled ? active : inactive
    })
  }
  return items
}

interface RawHookEntry {
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}

function scanHooksFile(file: string, scope: ConfigScope, enabled: boolean): HookItem[] {
  const items: HookItem[] = []
  const json = readJson(file)
  const hooks = (json?.hooks ?? null) as Record<string, RawHookEntry[]> | null
  if (!hooks) return items
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        if (!h.command) continue
        items.push({
          kind: 'hook',
          event,
          matcher: entry.matcher ?? '',
          command: h.command,
          scope,
          enabled,
          file,
          managed: h.command.includes(DECK_HOOK_MARKER)
        })
      }
    }
  }
  return items
}

/** Archivo lateral donde claude-deck guarda las entradas desactivadas (hooks/MCP) */
export function deckDisabledFile(scope: ConfigScope, cwd: string): string {
  return scope === 'user'
    ? join(userClaudeDir(), 'deck-disabled.json')
    : join(cwd, '.claude', 'deck-disabled.json')
}

interface DeckDisabled {
  hooks?: { event: string; matcher: string; command: string; file: string }[]
  mcp?: Record<string, unknown>
}

export function readDeckDisabled(scope: ConfigScope, cwd: string): DeckDisabled {
  return (readJson(deckDisabledFile(scope, cwd)) as DeckDisabled) ?? {}
}

function scanMcp(cwd: string): ConfigItem[] {
  const items: ConfigItem[] = []
  const projectFile = join(cwd, '.mcp.json')
  const servers = (readJson(projectFile)?.mcpServers ?? {}) as Record<string, unknown>
  for (const name of Object.keys(servers)) {
    items.push({
      kind: 'mcp',
      name,
      description: describeMcp(servers[name]),
      scope: 'project',
      enabled: true,
      path: projectFile
    })
  }
  const disabled = readDeckDisabled('project', cwd).mcp ?? {}
  for (const name of Object.keys(disabled)) {
    items.push({
      kind: 'mcp',
      name,
      description: describeMcp(disabled[name]),
      scope: 'project',
      enabled: false,
      path: projectFile
    })
  }
  // MCP a nivel usuario viven en ~/.claude.json (archivo de estado grande de
  // Claude Code): se muestran pero no se tocan desde la app.
  const userState = readJson(join(homedir(), '.claude.json'))
  const userServers = (userState?.mcpServers ?? {}) as Record<string, unknown>
  for (const name of Object.keys(userServers)) {
    items.push({
      kind: 'mcp',
      name,
      description: describeMcp(userServers[name]),
      scope: 'user',
      enabled: true,
      path: join(homedir(), '.claude.json'),
      readonly: true
    })
  }
  return items
}

function describeMcp(def: unknown): string {
  const d = def as { command?: string; args?: string[]; url?: string; type?: string }
  if (d?.url) return `${d.type ?? 'http'} → ${d.url}`
  if (d?.command) return [d.command, ...(d.args ?? [])].join(' ').slice(0, 120)
  return ''
}

function claudeMdInfo(path: string, scope: ConfigScope): ClaudeMdInfo {
  let bytes = 0
  let preview = ''
  const exists = existsSync(path)
  if (exists) {
    try {
      const content = readFileSync(path, 'utf8')
      bytes = Buffer.byteLength(content)
      preview = content.slice(0, 400)
    } catch {
      /* ignore */
    }
  }
  return { scope, path, exists, bytes, preview }
}

/** Agentes globales del PC (~/.claude/agents), para el diálogo de nueva pestaña */
export function listGlobalAgents(): { name: string; description: string }[] {
  return scanAgents(join(userClaudeDir(), 'agents'), 'user')
    .filter((a) => a.enabled)
    .map((a) => ({ name: a.name, description: a.description }))
}

export function scanProject(cwd: string): ProjectConfig {
  const userDir = userClaudeDir()
  const projDir = join(cwd, '.claude')

  const hooks: HookItem[] = [
    ...scanHooksFile(join(userDir, 'settings.json'), 'user', true),
    ...scanHooksFile(join(projDir, 'settings.json'), 'project', true),
    ...scanHooksFile(join(projDir, 'settings.local.json'), 'project', true)
  ]
  for (const scope of ['user', 'project'] as ConfigScope[]) {
    for (const h of readDeckDisabled(scope, cwd).hooks ?? []) {
      hooks.push({
        kind: 'hook',
        event: h.event,
        matcher: h.matcher,
        command: h.command,
        scope,
        enabled: false,
        file: h.file,
        managed: h.command.includes(DECK_HOOK_MARKER)
      })
    }
  }

  return {
    cwd,
    agents: [
      ...scanAgents(join(userDir, 'agents'), 'user'),
      ...scanAgents(join(projDir, 'agents'), 'project')
    ],
    commands: [
      ...scanMdItems(join(userDir, 'commands'), 'user', 'command'),
      ...scanMdItems(join(projDir, 'commands'), 'project', 'command')
    ],
    skills: [
      ...scanSkills(join(userDir, 'skills'), 'user'),
      ...scanSkills(join(projDir, 'skills'), 'project')
    ],
    hooks,
    mcp: scanMcp(cwd),
    claudeMd: [
      claudeMdInfo(join(userDir, 'CLAUDE.md'), 'user'),
      claudeMdInfo(join(cwd, 'CLAUDE.md'), 'project')
    ],
    deckHooksInstalled: hooks.some((h) => h.managed && h.enabled && h.scope === 'project')
  }
}
