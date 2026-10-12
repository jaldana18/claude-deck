/**
 * Lógica pura de los componentes ricos del chat (sin React ni CSS) para que
 * los tests de Node la importen directamente.
 */
import type { ChatMessage, ChatToolUse } from '../../../../shared/types'

/** `inputObj` lo añade el proceso principal en paralelo; aquí es opcional */
export type RichToolUse = ChatToolUse & { inputObj?: Record<string, unknown> }
export type RichMessage = ChatMessage & { thinking?: string }

export interface FileChange {
  path: string
  added: number
  removed: number
  kind: 'edit' | 'write'
}

export type TestsState = 'pass' | 'fail' | null

export type ToolItem =
  | { kind: 'tool'; tu: RichToolUse }
  | { kind: 'group'; id: string; tools: RichToolUse[]; files: number; searches: number; web: number }

const HIDDEN = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList'])
const READ_ONLY = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead'
])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

export const isHiddenTool = (name: string): boolean => HIDDEN.has(name)
export const isReadOnlyTool = (name: string): boolean => READ_ONLY.has(name)
export const isEditTool = (name: string): boolean => EDIT_TOOLS.has(name)
export const isShellTool = (name: string): boolean => SHELL_TOOLS.has(name)
export const isAgentTool = (name: string): boolean => name === 'Agent' || name === 'Task'

// ---------------------------------------------------------------------------
// Input estructurado
// ---------------------------------------------------------------------------

export interface ParsedInput {
  obj: Record<string, unknown>
  /** el input llegó recortado: el diff/contenido puede estar incompleto */
  truncated: boolean
}

/** Umbral a partir del cual se asume que un string de `inputObj` fue recortado */
const OBJ_STR_LIMIT = 7990

const parseCache = new WeakMap<object, ParsedInput>()

/**
 * Input del tool como objeto: `inputObj` si viene; si no, `JSON.parse(input)`;
 * si el JSON está cortado (el principal lo recorta a 1200 y añade «…»), se
 * rescatan los campos string/número que se puedan leer.
 */
export function toolInput(tu: RichToolUse): ParsedInput {
  const hit = parseCache.get(tu)
  if (hit) return hit
  let res: ParsedInput
  if (tu.inputObj && typeof tu.inputObj === 'object') {
    res = { obj: tu.inputObj, truncated: hasLongString(tu.inputObj) }
  } else {
    try {
      const v = JSON.parse(tu.input) as unknown
      res = {
        obj: v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {},
        truncated: false
      }
    } catch {
      res = { obj: looseParse(tu.input ?? ''), truncated: true }
    }
  }
  parseCache.set(tu, res)
  return res
}

function hasLongString(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return v.length >= OBJ_STR_LIMIT
  if (depth > 3 || !v || typeof v !== 'object') return false
  return Object.values(v as Record<string, unknown>).some((x) => hasLongString(x, depth + 1))
}

/** Decodifica el cuerpo de un string JSON que puede venir sin cerrar */
function decodeJsonString(raw: string): string {
  let s = raw
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(`"${s}"`) as string
    } catch {
      s = s.slice(0, -1)
    }
  }
  return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

const STR_RE = /"([A-Za-z_][\w]*)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g
const SCALAR_RE = /"([A-Za-z_][\w]*)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)\b/g

function looseParse(text: string): Record<string, unknown> {
  const body = text.replace(/\n…$/, '')
  const obj: Record<string, unknown> = {}
  const edits: Record<string, unknown>[] = []
  let cur: Record<string, unknown> | null = null
  for (const m of body.matchAll(STR_RE)) {
    const [, key, raw] = m
    const val = decodeJsonString(raw)
    if (key === 'old_string' || key === 'new_string') {
      // en MultiEdit los pares se repiten; el primero de cada par abre uno nuevo
      if (!cur || key in cur) {
        cur = {}
        edits.push(cur)
      }
      cur[key] = val
    }
    if (!(key in obj)) obj[key] = val
  }
  for (const m of body.matchAll(SCALAR_RE)) {
    const [, key, raw] = m
    if (key in obj) continue
    obj[key] = raw === 'true' ? true : raw === 'false' ? false : Number(raw)
  }
  if (/"edits"\s*:/.test(body)) obj.edits = edits
  return obj
}

export const str = (o: Record<string, unknown>, k: string): string | undefined =>
  typeof o[k] === 'string' ? (o[k] as string) : undefined

export const num = (o: Record<string, unknown>, k: string): number | undefined =>
  typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined

export function filePathOf(o: Record<string, unknown>): string | undefined {
  return str(o, 'file_path') ?? str(o, 'notebook_path') ?? str(o, 'path')
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

/** Ruta relativa a cwd si cuelga de él (insensible a mayúsculas y separador) */
export function relPath(path: string, cwd: string): string {
  if (!path || !cwd) return path
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = norm(path)
  const c = norm(cwd)
  if (p.toLowerCase() === c.toLowerCase()) return '.'
  if (p.toLowerCase().startsWith(c.toLowerCase() + '/')) return p.slice(c.length + 1)
  return path
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

export function splitLines(s: string): string[] {
  if (!s) return []
  return s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

export interface Hunk {
  pre: string[]
  del: string[]
  ins: string[]
  post: string[]
}

/** Recorta las líneas comunes de inicio y fin: lo que queda es lo que cambió */
export function computeHunk(oldText: string, newText: string): Hunk {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  return {
    pre: a.slice(0, s),
    del: a.slice(s, a.length - e),
    ins: b.slice(s, b.length - e),
    post: a.slice(a.length - e)
  }
}

/** Pares old/new de un tool de edición (Write = todo añadido) */
export function editPairs(tu: RichToolUse): { oldText: string; newText: string }[] {
  const { obj } = toolInput(tu)
  switch (tu.name) {
    case 'Edit':
      return [{ oldText: str(obj, 'old_string') ?? '', newText: str(obj, 'new_string') ?? '' }]
    case 'MultiEdit': {
      const edits = Array.isArray(obj.edits) ? (obj.edits as Record<string, unknown>[]) : []
      return edits.map((e) => ({
        oldText: typeof e?.old_string === 'string' ? e.old_string : '',
        newText: typeof e?.new_string === 'string' ? e.new_string : ''
      }))
    }
    case 'Write':
      return [{ oldText: '', newText: str(obj, 'content') ?? '' }]
    case 'NotebookEdit':
      return str(obj, 'edit_mode') === 'delete'
        ? []
        : [{ oldText: '', newText: str(obj, 'new_source') ?? '' }]
    default:
      return []
  }
}

/** +N −M de un tool de edición; null si no es de edición */
export function diffStats(tu: RichToolUse): { added: number; removed: number } | null {
  if (!isEditTool(tu.name)) return null
  let added = 0
  let removed = 0
  for (const { oldText, newText } of editPairs(tu)) {
    const h = computeHunk(oldText, newText)
    added += h.ins.length
    removed += h.del.length
  }
  return { added, removed }
}

// ---------------------------------------------------------------------------
// Agrupación
// ---------------------------------------------------------------------------

const FILE_TOOLS = new Set(['Read', 'LS', 'NotebookRead'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'ToolSearch'])

/**
 * Quita los tools ocultos y agrupa las rachas de ≥3 lecturas consecutivas en
 * un bloque «Exploró…».
 */
export function groupToolUses(toolUses: RichToolUse[]): ToolItem[] {
  const out: ToolItem[] = []
  let run: RichToolUse[] = []
  const flush = (): void => {
    if (run.length >= 3) {
      let files = 0
      let searches = 0
      let web = 0
      for (const t of run) {
        if (FILE_TOOLS.has(t.name)) files++
        else if (SEARCH_TOOLS.has(t.name)) searches++
        else web++
      }
      out.push({ kind: 'group', id: run[0].id, tools: run, files, searches, web })
    } else {
      for (const tu of run) out.push({ kind: 'tool', tu })
    }
    run = []
  }
  for (const tu of toolUses) {
    if (isHiddenTool(tu.name)) continue
    if (isReadOnlyTool(tu.name)) {
      run.push(tu)
      continue
    }
    flush()
    out.push({ kind: 'tool', tu })
  }
  flush()
  return out
}

export function groupLabel(g: { files: number; searches: number; web: number }): string {
  const parts: string[] = []
  if (g.files) parts.push(`${g.files} ${g.files === 1 ? 'archivo' : 'archivos'}`)
  if (g.searches) parts.push(`${g.searches} ${g.searches === 1 ? 'búsqueda' : 'búsquedas'}`)
  if (g.web) parts.push(`${g.web} ${g.web === 1 ? 'página' : 'páginas'}`)
  return `Exploró ${parts.join(' · ')}`
}

// ---------------------------------------------------------------------------
// Línea de lectura
// ---------------------------------------------------------------------------

export interface ReadLine {
  verb: string
  target?: string
  /** valor a pasar a onOpenPath si el target es clicable */
  open?: string
  /** segundo objetivo («en `path`») */
  where?: string
  whereOpen?: string
  extra?: string
}

export function readLineFor(tu: RichToolUse, cwd: string): ReadLine {
  const { obj } = toolInput(tu)
  const fp = filePathOf(obj)
  switch (tu.name) {
    case 'Read':
    case 'NotebookRead': {
      const off = num(obj, 'offset')
      const lim = num(obj, 'limit')
      let extra: string | undefined
      if (off !== undefined && lim !== undefined) extra = `${off}–${off + lim - 1}`
      else if (off !== undefined) extra = `desde ${off}`
      else if (lim !== undefined) extra = `1–${lim}`
      return { verb: 'Leyó', target: fp && relPath(fp, cwd), open: fp, extra }
    }
    case 'Grep': {
      const p = str(obj, 'path')
      const glob = str(obj, 'glob') ?? str(obj, 'type')
      return {
        verb: 'Buscó',
        target: str(obj, 'pattern'),
        where: p ? relPath(p, cwd) : glob,
        whereOpen: p
      }
    }
    case 'Glob': {
      const p = str(obj, 'path')
      return {
        verb: 'Listó',
        target: str(obj, 'pattern'),
        where: p ? relPath(p, cwd) : undefined,
        whereOpen: p
      }
    }
    case 'LS':
      return { verb: 'Listó', target: fp && relPath(fp, cwd), open: fp }
    case 'WebFetch': {
      const url = str(obj, 'url')
      return { verb: 'Consultó', target: url, open: url }
    }
    case 'WebSearch':
      return { verb: 'Buscó en la web', target: str(obj, 'query') }
    case 'ToolSearch':
      return { verb: 'Buscó herramientas', target: str(obj, 'query') }
    default:
      return { verb: prettyToolName(tu.name) }
  }
}

/** mcp__server__tool → «server · tool» */
export function prettyToolName(name: string): string {
  const m = name.match(/^mcp__(.+?)__(.+)$/)
  if (m) return `${m[1].replace(/_/g, ' ')} · ${m[2].replace(/_/g, ' ')}`
  return name
}

/** Últimas `n` líneas no vacías del resultado */
export function tailLines(text: string | undefined, n = 6): string[] {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '')
  return lines.slice(-n)
}

// ---------------------------------------------------------------------------
// Resumen de turno
// ---------------------------------------------------------------------------

const TEST_RE = new RegExp(
  [
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?\b`,
    String.raw`\b(?:npx\s+)?(?:vitest|jest|mocha|playwright\s+test|phpunit|rspec)\b`,
    String.raw`\bpytest\b`,
    String.raw`\bpython3?\s+-m\s+(?:pytest|unittest)\b`,
    String.raw`\bdotnet\s+test\b`,
    String.raw`\bgo\s+test\b`,
    String.raw`\bcargo\s+test\b`,
    String.raw`\bmvn\w*\s+(?:\S+\s+)*test\b`,
    String.raw`\bgradlew?(?:\.bat)?\s+(?:\S+\s+)*test\b`
  ].join('|'),
  'i'
)

export function isTestCommand(cmd: string | undefined): boolean {
  return Boolean(cmd && TEST_RE.test(cmd))
}

/**
 * Agrega por archivo los Edit/MultiEdit/Write/NotebookEdit de los mensajes
 * (los que fallaron no cuentan) y el estado del último comando de tests.
 */
export function computeTurnChanges(messages: ChatMessage[]): { changes: FileChange[]; tests: TestsState } {
  const byPath = new Map<string, FileChange>()
  let tests: TestsState = null
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const tu of m.toolUses as RichToolUse[]) {
      if (isEditTool(tu.name)) {
        if (tu.isError) continue
        const fp = filePathOf(toolInput(tu).obj)
        if (!fp) continue
        const st = diffStats(tu) ?? { added: 0, removed: 0 }
        const key = fp.replace(/\\/g, '/').toLowerCase()
        const prev = byPath.get(key)
        const kind: FileChange['kind'] = tu.name === 'Write' ? 'write' : 'edit'
        if (prev) {
          prev.added += st.added
          prev.removed += st.removed
          if (kind === 'write') prev.kind = 'write'
        } else {
          byPath.set(key, { path: fp, added: st.added, removed: st.removed, kind })
        }
      } else if (isShellTool(tu.name) && tu.result !== undefined) {
        if (isTestCommand(str(toolInput(tu).obj, 'command'))) tests = tu.isError ? 'fail' : 'pass'
      }
    }
  }
  return { changes: [...byPath.values()], tests }
}

// ---------------------------------------------------------------------------
// Avisos de la app
// ---------------------------------------------------------------------------

export type NoticeTone = 'info' | 'warn' | 'error'

const NOTICES: { re: RegExp; tone: NoticeTone }[] = [
  { re: /^⟳\s*(Auto-compact\b[\s\S]*)$/, tone: 'info' },
  { re: /^⟳\s*(Compact terminado\b[\s\S]*)$/, tone: 'info' },
  { re: /^⚠️?\s*(Auto-compact detenido\b[\s\S]*)$/, tone: 'warn' },
  { re: /^⟳\s*(Continuación automática\b[\s\S]*)$/, tone: 'info' }
]

/** Reconoce los avisos que ChatView emite como mensajes de usuario */
export function parseSystemNotice(text: string): { tone: NoticeTone; text: string } | null {
  if (!text) return null
  const t = text.trim()
  for (const n of NOTICES) {
    const m = t.match(n.re)
    if (m) return { tone: n.tone, text: m[1] }
  }
  return null
}

// ---------------------------------------------------------------------------
// Estado en vivo
// ---------------------------------------------------------------------------

export interface LiveState {
  /** cambia cuando cambia lo que se está haciendo: reinicia el cronómetro */
  key: string
  label: string
  /** fragmento en mono tras la etiqueta */
  code?: string
  /** otros tools pendientes en paralelo */
  more: number
}

function oneLine(s: string, max = 80): string {
  const l = s.replace(/\s+/g, ' ').trim()
  return l.length > max ? l.slice(0, max - 1) + '…' : l
}

export function liveStateFor(
  messages: ChatMessage[],
  opts: { streamingText?: string; compacting?: boolean; cwd?: string } = {}
): LiveState {
  if (opts.compacting) return { key: 'compact', label: 'Compactando la conversación', more: 0 }
  const cwd = opts.cwd ?? ''
  let last: ChatMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      last = messages[i]
      break
    }
    if (messages[i].role === 'user' && !parseSystemNotice(messages[i].text)) break
  }
  const pending = (last?.toolUses ?? []).filter((t) => t.result === undefined) as RichToolUse[]
  if (pending.length > 0) {
    const tu = pending[pending.length - 1]
    const more = pending.length - 1
    const { obj } = toolInput(tu)
    const fp = filePathOf(obj)
    const rel = fp ? relPath(fp, cwd) : undefined
    const k = `tool:${tu.id}`
    switch (tu.name) {
      case 'Bash':
      case 'PowerShell':
        return { key: k, label: 'Ejecutando', code: oneLine(str(obj, 'command') ?? ''), more }
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return { key: k, label: 'Editando', code: rel, more }
      case 'Write':
        return { key: k, label: 'Escribiendo', code: rel, more }
      case 'Read':
      case 'NotebookRead':
        return { key: k, label: 'Leyendo', code: rel, more }
      case 'LS':
        return { key: k, label: 'Listando', code: rel, more }
      case 'Grep':
      case 'Glob':
        return { key: k, label: 'Buscando', code: str(obj, 'pattern'), more }
      case 'WebFetch':
        return { key: k, label: 'Consultando', code: str(obj, 'url'), more }
      case 'WebSearch':
        return { key: k, label: 'Buscando en la web', code: str(obj, 'query'), more }
      case 'Agent':
      case 'Task':
        return {
          key: k,
          label: `Subagente: ${oneLine(str(obj, 'description') ?? str(obj, 'subagent_type') ?? 'trabajando')}`,
          more
        }
      case 'TodoWrite':
      case 'TaskCreate':
      case 'TaskUpdate':
      case 'TaskList':
        return { key: k, label: 'Actualizando tareas', more }
      default:
        return { key: k, label: `Usando ${prettyToolName(tu.name)}`, more }
    }
  }
  if (opts.streamingText || last?.streaming) return { key: 'writing', label: 'Escribiendo', more: 0 }
  return { key: 'thinking', label: 'Pensando', more: 0 }
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return ''
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g)
  return m ? m.length : 0
}
