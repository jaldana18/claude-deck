/**
 * Resolución del destino de un arrastre de widgets.
 *
 * Antes el destino se resolvía con `elementsFromPoint`, que exige que el
 * puntero esté EXACTAMENTE encima del elemento: con un dock vacío la única
 * zona válida era el recuadro punteado de 80px, así que había que llevar el
 * widget literalmente a la esquina para que lo aceptara. Aquí se resuelve por
 * cercanía: si el puntero está dentro de un dock gana ese, y si está fuera
 * gana el más próximo mientras no se aleje más de `threshold` píxeles.
 *
 * La geometría vive en shared/ (sin DOM) para poder testearla.
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DockBox<S> {
  side: S
  box: Box
}

/** Distancia euclídea del punto al rectángulo; 0 si el punto está dentro. */
export function distanceToBox(x: number, y: number, b: Box): number {
  const dx = Math.max(b.left - x, 0, x - b.right)
  const dy = Math.max(b.top - y, 0, y - b.bottom)
  return Math.hypot(dx, dy)
}

/**
 * Dock más cercano al puntero, o null si todos quedan más lejos del umbral.
 * Con empate (por ejemplo el punto dentro de dos rectángulos solapados) gana
 * el primero de la lista, que es el orden en que están en el DOM.
 */
export function nearestDock<S>(
  x: number,
  y: number,
  docks: DockBox<S>[],
  threshold = 160
): S | null {
  let best: S | null = null
  let bestDist = Infinity
  for (const d of docks) {
    const dist = distanceToBox(x, y, d.box)
    if (dist < bestDist) {
      bestDist = dist
      best = d.side
    }
  }
  return bestDist <= threshold ? best : null
}
