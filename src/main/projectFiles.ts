import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { rankFiles } from '../shared/fileMatch'

const CACHE_MS = 15_000
const MAX_WALK = 20_000
const IGNORED = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'build', '.next'])

const cache = new Map<string, { at: number; files: Promise<string[]> }>()

/** Hasta 50 rutas relativas (con '/') del proyecto que casan con `query`. */
export async function listProjectFiles(cwd: string, query: string): Promise<string[]> {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return []
  try {
    if (!(await stat(cwd)).isDirectory()) return []
  } catch {
    return []
  }
  const now = Date.now()
  let entry = cache.get(cwd)
  if (!entry || now - entry.at > CACHE_MS) {
    entry = { at: now, files: gitFiles(cwd).catch(() => walk(cwd)) }
    cache.set(cwd, entry)
  }
  const files = await entry.files
  return rankFiles(files, typeof query === 'string' ? query : '')
}

function gitFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // -z: sin él git entrecomilla y escapa las rutas con caracteres no ASCII
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve([...new Set(stdout.split('\0').filter(Boolean))])
      }
    )
  })
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  const pending = ['']
  while (pending.length > 0 && out.length < MAX_WALK) {
    const rel = pending.shift()!
    let entries
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!IGNORED.has(e.name)) pending.push(path)
      } else if (e.isFile()) {
        out.push(path)
        if (out.length >= MAX_WALK) break
      }
    }
  }
  return out
}
