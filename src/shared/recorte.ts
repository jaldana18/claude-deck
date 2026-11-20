/**
 * Un log pegado de millones de caracteres congela el renderer al pintarlo como
 * markdown, y la pestaña deja de abrirse. A Claude le llega completo; la vista
 * se queda con el principio y el final, que es donde suelen estar el comando y
 * el error.
 */
export const MAX_CHARS_VISTA = 20_000
const TRAMO = 8_000

export function recortarParaVista(texto: string): string {
  if (texto.length <= MAX_CHARS_VISTA) return texto
  const omitidos = texto.length - 2 * TRAMO
  return (
    texto.slice(0, TRAMO) +
    `\n\n[… ${omitidos.toLocaleString('es')} caracteres omitidos en la vista; Claude recibió el mensaje completo …]\n\n` +
    texto.slice(-TRAMO)
  )
}
