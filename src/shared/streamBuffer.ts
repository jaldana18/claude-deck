/** Trozo de respuesta en curso: el id del mensaje al que pertenece y su texto. */
export interface StreamChunk {
  id: string
  text: string
}

/**
 * Acumula un delta del stream sobre lo que ya había.
 *
 * Las tres rutas que manejan deltas —la pestaña visible, el buffer de la
 * pestaña oculta y el volcado de ese buffer al volver a ella— tienen que
 * fusionar exactamente igual, o el texto se duplica o se pierde al cambiar de
 * pestaña a media respuesta. Por eso es una única función y no tres inline.
 *
 * Un `id` distinto significa mensaje nuevo: se descarta lo anterior en vez de
 * concatenar respuestas de turnos distintos.
 */
export function appendDelta(prev: StreamChunk | null, id: string, text: string): StreamChunk {
  return prev && prev.id === id ? { id, text: prev.text + text } : { id, text }
}
