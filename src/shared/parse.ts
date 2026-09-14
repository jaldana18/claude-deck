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
 * Extrae el bloque JSON de un texto que puede traer preámbulo o envoltorios.
 * El MCP de azure-devops antepone "Project: X, Team: Y" y, desde la v2.10,
 * envuelve todo en marcadores «<<hash>> [UNTRUSTED ...] <<hash>>» que también
 * contienen corchetes; por eso no basta con cortar del primer corchete al
 * último: hay que probar cada bloque balanceado hasta hallar JSON válido.
 */
export function extractJsonBlock(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '[' && ch !== '{') continue
    const end = scanBalanced(text, i)
    if (end === -1) continue
    const block = text.slice(i, end + 1)
    try {
      JSON.parse(block)
      return block
    } catch {
      /* no era JSON: probar el siguiente candidato */
    }
  }
  return null
}

/** Fin del bloque con corchetes/llaves balanceados desde `start`, respetando
 *  strings JSON (comillas y escapes). -1 si no cierra o cierra desparejado. */
function scanBalanced(text: string, start: number): number {
  const stack: string[] = []
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') stack.push(ch)
    else if (ch === ']' || ch === '}') {
      const open = stack.pop()
      if ((ch === ']' && open !== '[') || (ch === '}' && open !== '{')) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}
