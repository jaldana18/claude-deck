/**
 * Rutas para insertar en el chat.
 *
 * Se manda la RUTA y no el contenido: el contenido de un archivo metido en un
 * mensaje se queda en el contexto y se recobra —y se paga— en cada turno
 * posterior de la sesión. Con la ruta, Claude lee solo lo que necesita y
 * cuando lo necesita.
 */

/** Extensiones que el modelo puede ver como imagen (se adjuntan, no se citan) */
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

export function isImagePath(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext))
}

/** media type a partir de la extensión, o null si no es una imagen soportada */
export function imageMediaType(path: string): string | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return null
}

/**
 * Ruta relativa al proyecto, con barras normales. Se prefiere la relativa
 * porque es más corta (menos tokens en cada turno) y es la forma en que se
 * nombran los archivos dentro de un repo. Si la ruta cae fuera del proyecto se
 * devuelve la absoluta, que ahí sí es la única que identifica el archivo.
 */
export function relativeToCwd(path: string, cwd: string): string {
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = norm(path)
  const base = norm(cwd)
  if (!base) return p
  // Windows es insensible a mayúsculas: comparar en minúsculas pero devolver
  // el texto original, que es el que el usuario reconoce.
  if (p.toLowerCase().startsWith(base.toLowerCase() + '/')) return p.slice(base.length + 1)
  if (p.toLowerCase() === base.toLowerCase()) return '.'
  return p
}
