import { join } from 'node:path'
import { renameSync } from 'node:fs'
import type { ConfigScope, HookItem } from '../shared/types'
import { DISABLED_SUFFIX, deckDisabledFile, readDeckDisabled } from './configScanner'
import { backup, readJsonOr, writeJson } from './jsonEdit'

/** Agentes: renombrar archivo .md <-> .md.deck-disabled */
export function toggleAgent(path: string, enable: boolean): void {
  if (enable && path.endsWith(DISABLED_SUFFIX)) {
    renameSync(path, path.slice(0, -DISABLED_SUFFIX.length))
  } else if (!enable && path.endsWith('.md')) {
    renameSync(path, path + DISABLED_SUFFIX)
  }
}

/** Skills: renombrar SKILL.md <-> SKILL.md.deck-disabled dentro de la carpeta */
export function toggleSkill(path: string, enable: boolean): void {
  toggleAgent(path, enable)
}

/**
 * Hooks: desactivar = quitar la entrada del settings y guardarla íntegra en
 * deck-disabled.json; activar = el camino inverso. Siempre con backup.
 */
export function toggleHook(hook: HookItem, cwd: string, enable: boolean): void {
  const disabledFile = deckDisabledFile(hook.scope, cwd)
  const registry = readDeckDisabled(hook.scope, cwd)
  registry.hooks = registry.hooks ?? []

  if (!enable) {
    backup(hook.file)
    const settings = readJsonOr(hook.file, {})
    const entries = settings.hooks?.[hook.event]
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if ((entry.matcher ?? '') !== hook.matcher) continue
        entry.hooks = (entry.hooks ?? []).filter((h: any) => h.command !== hook.command)
      }
      settings.hooks[hook.event] = entries.filter((e: any) => (e.hooks ?? []).length > 0)
      if (settings.hooks[hook.event].length === 0) delete settings.hooks[hook.event]
      writeJson(hook.file, settings)
    }
    if (!registry.hooks.some((h) => h.event === hook.event && h.command === hook.command)) {
      registry.hooks.push({
        event: hook.event,
        matcher: hook.matcher,
        command: hook.command,
        file: hook.file
      })
    }
    writeJson(disabledFile, registry)
  } else {
    backup(hook.file)
    const settings = readJsonOr(hook.file, {})
    settings.hooks = settings.hooks ?? {}
    settings.hooks[hook.event] = settings.hooks[hook.event] ?? []
    let entry = settings.hooks[hook.event].find((e: any) => (e.matcher ?? '') === hook.matcher)
    if (!entry) {
      entry = hook.matcher ? { matcher: hook.matcher, hooks: [] } : { hooks: [] }
      settings.hooks[hook.event].push(entry)
    }
    entry.hooks = entry.hooks ?? []
    if (!entry.hooks.some((h: any) => h.command === hook.command)) {
      entry.hooks.push({ type: 'command', command: hook.command })
    }
    writeJson(hook.file, settings)
    registry.hooks = registry.hooks.filter(
      (h) => !(h.event === hook.event && h.command === hook.command)
    )
    writeJson(disabledFile, registry)
  }
}

/** MCP de proyecto: mover la definición entre .mcp.json y deck-disabled.json */
export function toggleMcp(cwd: string, name: string, enable: boolean): void {
  const mcpFile = join(cwd, '.mcp.json')
  const disabledFile = deckDisabledFile('project', cwd)
  const registry = readDeckDisabled('project', cwd)
  registry.mcp = registry.mcp ?? {}
  const settings = readJsonOr(mcpFile, {})
  settings.mcpServers = settings.mcpServers ?? {}

  if (!enable) {
    if (!(name in settings.mcpServers)) return
    backup(mcpFile)
    registry.mcp[name] = settings.mcpServers[name]
    delete settings.mcpServers[name]
    writeJson(mcpFile, settings)
    writeJson(disabledFile, registry)
  } else {
    if (!(name in registry.mcp)) return
    backup(mcpFile)
    settings.mcpServers[name] = registry.mcp[name]
    delete registry.mcp[name]
    writeJson(mcpFile, settings)
    writeJson(disabledFile, registry)
  }
}

export function toggleItem(
  kind: 'agent' | 'skill' | 'mcp' | 'command',
  cwd: string,
  path: string,
  name: string,
  enable: boolean
): void {
  if (kind === 'agent' || kind === 'command') toggleAgent(path, enable)
  else if (kind === 'skill') toggleSkill(path, enable)
  else toggleMcp(cwd, name, enable)
}

export type { ConfigScope }
