import { useEffect, useRef, useState } from 'react'
import { deckExtra } from './deckExtra'

export interface MentionToken {
  /** índice del «@» en el texto */
  start: number
  query: string
}

/** Mención en curso justo antes del cursor (`@` + texto sin espacios) */
export function mentionAt(text: string, caret: number): MentionToken | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** Menciones `@ruta` completas del texto, sin repetir y en orden de aparición */
export function extractMentions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(^|\s)@([^\s@]+)/g)) {
    if (!out.includes(m[2])) out.push(m[2])
  }
  return out
}

/** Quita todas las apariciones de `@ruta` (y el espacio que la sigue) */
export function removeMention(text: string, path: string): string {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(^|\\s)@${esc}(?=\\s|$)[ \\t]?`, 'g'), '$1')
}

const DEBOUNCE_MS = 120
const MAX_RESULTS = 14

/**
 * Archivos del proyecto que encajan con la mención en curso. Sin la API en el
 * puente devuelve siempre vacío, y el menú simplemente no aparece.
 */
export function useFileMentions(cwd: string, query: string | null): string[] {
  const [results, setResults] = useState<string[]>([])
  // Solo vale la respuesta de la última consulta: con el debounce y la latencia
  // del IPC, una respuesta lenta de «@sr» podría pisar la de «@src».
  const seq = useRef(0)
  useEffect(() => {
    const api = deckExtra().listProjectFiles
    const mine = ++seq.current
    if (query === null || !api) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      api(cwd, query)
        .then((r) => mine === seq.current && setResults(r.slice(0, MAX_RESULTS)))
        .catch(() => mine === seq.current && setResults([]))
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [cwd, query])
  return results
}
