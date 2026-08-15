import { describe, expect, it } from 'vitest'
import { distanceToBox, nearestDock, type DockBox } from '../src/shared/dropTarget'

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom
})

describe('distanceToBox', () => {
  const b = box(100, 100, 200, 200)

  it('es 0 dentro del rectángulo y en el borde', () => {
    expect(distanceToBox(150, 150, b)).toBe(0)
    expect(distanceToBox(100, 100, b)).toBe(0)
    expect(distanceToBox(200, 200, b)).toBe(0)
  })

  it('mide la distancia perpendicular fuera de un lado', () => {
    expect(distanceToBox(80, 150, b)).toBe(20)
    expect(distanceToBox(230, 150, b)).toBe(30)
    expect(distanceToBox(150, 60, b)).toBe(40)
  })

  it('mide la diagonal fuera de una esquina', () => {
    expect(distanceToBox(97, 96, b)).toBeCloseTo(5) // 3-4-5
  })
})

describe('nearestDock', () => {
  // maqueta típica: dock izquierdo, chat en medio, dock derecho
  const docks: DockBox<'left' | 'right'>[] = [
    { side: 'left', box: box(0, 50, 250, 800) },
    { side: 'right', box: box(1100, 50, 1400, 800) }
  ]

  it('elige el dock que contiene el puntero', () => {
    expect(nearestDock(120, 400, docks)).toBe('left')
    expect(nearestDock(1200, 400, docks)).toBe('right')
  })

  it('acepta soltar CERCA del dock, sin acertar el recuadro', () => {
    // este es el caso que fallaba: había que llevarlo hasta la esquina
    expect(nearestDock(330, 400, docks)).toBe('left')
    expect(nearestDock(1000, 400, docks)).toBe('right')
  })

  it('devuelve null si se suelta lejos de todo dock', () => {
    expect(nearestDock(675, 400, docks)).toBeNull()
  })

  it('respeta un umbral a medida', () => {
    expect(nearestDock(330, 400, docks, 50)).toBeNull()
    expect(nearestDock(330, 400, docks, 100)).toBe('left')
  })

  it('sin docks no hay destino', () => {
    expect(nearestDock(100, 100, [])).toBeNull()
  })
})
