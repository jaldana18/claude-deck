import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ChatSearchResult } from '../shared/types'

/**
 * Búsqueda global sobre los transcripts locales de Claude Code
 * (los .jsonl bajo ~/.claude/projects). Sin índice en v1: recorre los archivos de
 * más reciente a más antiguo en streaming y corta al llegar al límite.
 */
export async function searchChats(query: string, limit = 25): Promise<ChatSearchResult[]> {
  const root = join(homedir(), '.claude', 'projects')
  if (!existsSync(root) || query.trim().length < 2) return []
  const needle = query.toLowerCase()

  const files: { file: string; projectDir: string; mtimeMs: number }[] = []
  for (const dir of readdirSync(root)) {
    const full = join(root, dir)
    try {
      if (!statSync(full).isDirectory()) continue
      for (const f of readdirSync(full)) {
        if (!f.endsWith('.jsonl')) continue
        const filePath = join(full, f)
        files.push({ file: filePath, projectDir: dir, mtimeMs: statSync(filePath).mtimeMs })
      }
    } catch {
      /* ignore */
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const results: ChatSearchResult[] = []
  for (const f of files) {
    if (results.length >= limit) break
    const hit = await searchFile(f.file, needle)
    if (hit) {
      results.push({
        sessionId: basename(f.file, '.jsonl'),
        cwd: hit.cwd,
        projectDir: f.projectDir,
        file: f.file,
        mtimeMs: f.mtimeMs,
        matchCount: hit.count,
        preview: hit.preview,
        firstTimestamp: hit.timestamp
      })
    }
  }
  return results
}

interface FileHit {
  cwd: string
  count: number
  preview: string
  timestamp?: string
}

function searchFile(file: string, needle: string): Promise<FileHit | null> {
  return new Promise((resolve) => {
    let cwd = ''
    let count = 0
    let preview = ''
    let timestamp: string | undefined
    const stream = createReadStream(file, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!cwd || count === 0) {
        // extraer metadatos aunque la línea no matchee
        try {
          const entry = JSON.parse(line)
          if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
          if (entry.type === 'user' || entry.type === 'assistant') {
            const text = extractText(entry)
            if (text && text.toLowerCase().includes(needle)) {
              count++
              if (!preview) {
                const i = text.toLowerCase().indexOf(needle)
                preview = text.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, ' ')
                timestamp = entry.timestamp
              }
            }
          }
          return
        } catch {
          return
        }
      }
      // ya hay match y cwd: solo contar apariciones adicionales (barato)
      if (line.toLowerCase().includes(needle)) count++
    })
    rl.on('close', () => resolve(count > 0 ? { cwd, count, preview, timestamp } : null))
    rl.on('error', () => resolve(null))
    stream.on('error', () => resolve(null))
  })
}

function extractText(entry: any): string {
  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}
