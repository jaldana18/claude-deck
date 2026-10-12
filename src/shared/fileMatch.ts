/**
 * Ranking difuso de rutas para las menciones @ del composer.
 *
 * La consulta casa si sus caracteres aparecen en orden dentro de la ruta
 * (subsecuencia, sin distinguir mayúsculas). Pesa más casar en el nombre del
 * archivo que en las carpetas, y a igualdad gana la ruta más corta.
 */

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** Huecos entre caracteres casados (búsqueda voraz), o -1 si no es subsecuencia */
function subsequenceGaps(query: string, text: string): number {
  let qi = 0
  let first = -1
  let last = -1
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      if (first < 0) first = i
      last = i
      qi++
    }
  }
  if (qi < query.length) return -1
  return query.length === 0 ? 0 : last - first + 1 - query.length
}

/** Puntuación de una ruta para la consulta (ya en minúsculas), o null si no casa */
export function scorePath(path: string, query: string): number | null {
  const lp = path.toLowerCase()
  if (!query) return 0
  const gaps = subsequenceGaps(query, lp)
  if (gaps < 0) return null
  const base = basename(lp)
  if (base === query) return 1000
  if (base.replace(/\.[^.]*$/, '') === query) return 900
  if (base.startsWith(query)) return 800
  if (base.includes(query)) return 600
  const baseGaps = subsequenceGaps(query, base)
  if (baseGaps >= 0) return 400 - Math.min(baseGaps, 100)
  if (lp.includes(query)) return 200
  return 100 - Math.min(gaps, 100)
}

export function rankFiles(paths: readonly string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase().replace(/\\/g, '/')
  const scored: { path: string; score: number }[] = []
  for (const path of paths) {
    const score = scorePath(path, q)
    if (score !== null) scored.push({ path, score })
  }
  scored.sort(
    (a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path)
  )
  return scored.slice(0, limit).map((s) => s.path)
}
