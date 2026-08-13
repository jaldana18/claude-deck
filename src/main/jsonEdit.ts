import { join, basename, dirname } from 'node:path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'

/**
 * Antes de modificar un archivo que Claude Code también escribe, se guarda una
 * copia en .deck-backups junto al archivo (se conservan las últimas 20).
 */
export function backup(file: string): void {
  if (!existsSync(file)) return
  const dir = join(dirname(file), '.deck-backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, join(dir, `${basename(file)}.${stamp}.bak`))
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(basename(file)))
    .sort()
  while (backups.length > 20) {
    const oldest = backups.shift()
    if (oldest) rmSync(join(dir, oldest), { force: true })
  }
}

export function readJsonOr(
  file: string,
  fallback: Record<string, any>
): Record<string, any> {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`No se pudo parsear ${file}: ${err}. No se modifica para no corromperlo.`)
  }
  return fallback
}

export function writeJson(file: string, data: Record<string, any>): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}
