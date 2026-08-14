/**
 * Helpers de parseo puros (sin Electron ni FS): se usan en main y renderer y
 * son la parte más frágil del sistema, por eso viven aparte y con tests.
 */

/** Divide una línea de argumentos respetando comillas simples y dobles */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Variables de entorno en formato CLAVE=valor, una por línea */
export function parseEnv(s: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of s.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

/** Nombre de archivo seguro en kebab-case (agentes, skills, comandos) */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sin-nombre'
  )
}

/**
 * Extrae el bloque JSON de un texto que puede traer preámbulo. El MCP de
 * azure-devops antepone líneas como "Project: X, Team: Y" antes del JSON;
 * sin esto el board se veía vacío. Devuelve null si no hay bloque.
 */
export function extractJsonBlock(text: string): string | null {
  const firstArr = text.indexOf('[')
  const firstObj = text.indexOf('{')
  const starts = [firstArr, firstObj].filter((i) => i >= 0)
  if (starts.length === 0) return null
  const start = Math.min(...starts)
  const end = text[start] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}')
  if (end <= start) return null
  return text.slice(start, end + 1)
}
