import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { ArtifactDraft, ValidationResult } from '../shared/types'
import { scanProject } from './configScanner'
import { backup, readJsonOr, writeJson } from './jsonEdit'

/**
 * Capa intermedia de validación con IA: antes de crear un agente/skill/hook se
 * consulta una sesión headless de Claude Code (`claude -p --output-format json`)
 * que evalúa si el borrador tiene lo mínimo viable. Devuelve viable/problemas/
 * sugerencias y una versión mejorada con redacción más clara.
 */
export async function validateArtifact(draft: ArtifactDraft): Promise<ValidationResult> {
  const existing = summarizeExisting(draft)
  const prompt = buildPrompt(draft, existing)
  try {
    const raw = await runClaudeHeadless(prompt, 120_000)
    return parseValidation(raw)
  } catch (err) {
    return {
      ok: false,
      viable: false,
      puntaje: 0,
      problemas: [],
      sugerencias: [],
      version_mejorada: null,
      error: String(err)
    }
  }
}

function summarizeExisting(draft: ArtifactDraft): string {
  try {
    const cfg = scanProject(draft.cwd)
    if (draft.kind === 'agent') {
      return cfg.agents.map((a) => `- ${a.name}: ${a.description}`.slice(0, 200)).join('\n')
    }
    if (draft.kind === 'skill') {
      return cfg.skills.map((s) => `- ${s.name}: ${s.description}`.slice(0, 200)).join('\n')
    }
    return cfg.hooks.map((h) => `- [${h.event}] matcher="${h.matcher}" cmd=${h.command.slice(0, 120)}`).join('\n')
  } catch {
    return '(no se pudo leer la configuración existente)'
  }
}

function buildPrompt(draft: ArtifactDraft, existing: string): string {
  const kindLabel =
    draft.kind === 'agent' ? 'subagente' : draft.kind === 'skill' ? 'skill' : 'hook'
  const body = JSON.stringify(draft.data, null, 2)
  return `Eres el revisor de calidad de configuraciones de Claude Code de la app claude-deck.
Evalúa si el siguiente borrador de ${kindLabel} tiene lo MÍNIMO VIABLE para funcionar bien.

Criterios:
1. La descripción debe decir con claridad CUÁNDO debe activarse/usarse (sin ambigüedad).
2. El propósito debe ser concreto y accionable, no genérico ("ayuda con el código" = mal).
3. No debe solaparse ni confundirse con los ya existentes (lista abajo).
${draft.kind === 'hook' ? '4. El evento debe ser uno válido de Claude Code (PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop, SessionStart, SessionEnd, PreCompact) y el comando debe ser ejecutable en Windows y coherente con el evento y el matcher.' : '4. El prompt/contenido debe dar instrucciones útiles y específicas, coherentes con la descripción.'}

${kindLabel.toUpperCase()}S YA EXISTENTES EN ESTE PROYECTO:
${existing || '(ninguno)'}

BORRADOR A EVALUAR:
${body}

Responde ÚNICAMENTE con un JSON válido, sin markdown ni texto adicional, con esta forma exacta:
{
  "viable": true|false,
  "puntaje": 0-10,
  "problemas": ["problema concreto", ...],
  "sugerencias": ["mejora concreta", ...],
  "version_mejorada": { ...mismos campos del borrador pero con redacción más clara y precisa (en español), SIEMPRE incluida aunque sea viable... }
}`
}

function runClaudeHeadless(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell:true para resolver el shim claude.cmd/claude.exe en Windows.
    const child = spawn('claude', ['-p', '--output-format', 'json', '--max-turns', '1'], {
      shell: true,
      windowsHide: true,
      env: process.env
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`El validador tardó más de ${timeoutMs / 1000}s`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`No se pudo ejecutar claude CLI: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && out.trim()) resolve(out)
      else reject(new Error(`claude -p terminó con código ${code}: ${err.slice(0, 500)}`))
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function parseValidation(raw: string): ValidationResult {
  let text = raw
  // --output-format json envuelve la respuesta en {"result": "..."} entre otros campos.
  try {
    const outer = JSON.parse(raw)
    if (typeof outer.result === 'string') text = outer.result
  } catch {
    /* raw ya es el texto */
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return {
      ok: false,
      viable: false,
      puntaje: 0,
      problemas: [],
      sugerencias: [],
      version_mejorada: null,
      error: 'El validador no devolvió JSON',
      raw: text.slice(0, 1000)
    }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return {
      ok: true,
      viable: Boolean(parsed.viable),
      puntaje: Number(parsed.puntaje ?? 0),
      problemas: asStringArray(parsed.problemas),
      sugerencias: asStringArray(parsed.sugerencias),
      version_mejorada:
        parsed.version_mejorada && typeof parsed.version_mejorada === 'object'
          ? parsed.version_mejorada
          : null
    }
  } catch (err) {
    return {
      ok: false,
      viable: false,
      puntaje: 0,
      problemas: [],
      sugerencias: [],
      version_mejorada: null,
      error: `JSON del validador inválido: ${err}`,
      raw: text.slice(0, 1000)
    }
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : []
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sin-nombre'
  )
}

/** Escribe el artefacto ya aprobado (o forzado por el usuario) en disco. */
export function createArtifact(draft: ArtifactDraft): { path: string } {
  const baseDir =
    draft.scope === 'user' ? join(homedir(), '.claude') : join(draft.cwd, '.claude')

  if (draft.kind === 'agent') {
    const dir = join(baseDir, 'agents')
    mkdirSync(dir, { recursive: true })
    const slug = slugify(draft.data.name)
    const file = join(dir, `${slug}.md`)
    if (existsSync(file)) throw new Error(`Ya existe un agente en ${file}`)
    const fm = [
      '---',
      `name: ${slug}`,
      `description: ${draft.data.description.replace(/\r?\n/g, ' ')}`,
      ...(draft.data.tools ? [`tools: ${draft.data.tools}`] : []),
      ...(draft.data.model ? [`model: ${draft.data.model}`] : []),
      '---',
      '',
      draft.data.prompt,
      ''
    ].join('\n')
    writeFileSync(file, fm, 'utf8')
    return { path: file }
  }

  if (draft.kind === 'skill') {
    const slug = slugify(draft.data.name)
    const dir = join(baseDir, 'skills', slug)
    const file = join(dir, 'SKILL.md')
    if (existsSync(file)) throw new Error(`Ya existe una skill en ${file}`)
    mkdirSync(dir, { recursive: true })
    const content = [
      '---',
      `name: ${slug}`,
      `description: ${draft.data.description.replace(/\r?\n/g, ' ')}`,
      ...(draft.data.tools ? [`allowed-tools: ${draft.data.tools}`] : []),
      '---',
      '',
      draft.data.content,
      ''
    ].join('\n')
    writeFileSync(file, content, 'utf8')
    return { path: file }
  }

  // hook → settings.local.json del scope elegido
  const file =
    draft.scope === 'user'
      ? join(homedir(), '.claude', 'settings.json')
      : join(draft.cwd, '.claude', 'settings.local.json')
  backup(file)
  const settings = readJsonOr(file, {})
  settings.hooks = settings.hooks ?? {}
  settings.hooks[draft.data.event] = settings.hooks[draft.data.event] ?? []
  let entry = settings.hooks[draft.data.event].find(
    (e: any) => (e.matcher ?? '') === (draft.data.matcher ?? '')
  )
  if (!entry) {
    entry = draft.data.matcher ? { matcher: draft.data.matcher, hooks: [] } : { hooks: [] }
    settings.hooks[draft.data.event].push(entry)
  }
  entry.hooks = entry.hooks ?? []
  entry.hooks.push({ type: 'command', command: draft.data.command })
  writeJson(file, settings)
  return { path: file }
}
