import { describe, it, expect } from 'vitest'
import {
  formatMessageTime,
  formatDuration,
  runDuration,
  formatFullTime
} from '../src/shared/messageTime'

// Fechas construidas con el constructor local (no con string ISO) para que el
// test no dependa de la zona horaria de quien lo corra.
const local = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(y, m - 1, d, h, min, 0, 0)

describe('formatMessageTime', () => {
  const ahora = local(2026, 8, 25, 18, 0)

  it('muestra solo la hora si el mensaje es de hoy', () => {
    expect(formatMessageTime(local(2026, 8, 25, 14, 32).toISOString(), ahora)).toBe('14:32')
  })

  it('rellena con cero las horas y minutos de un dígito', () => {
    expect(formatMessageTime(local(2026, 8, 25, 9, 5).toISOString(), ahora)).toBe('09:05')
  })

  it('añade el día y el mes si es de otro día', () => {
    expect(formatMessageTime(local(2026, 8, 24, 14, 32).toISOString(), ahora)).toBe('24 ago, 14:32')
  })

  it('añade el año solo si es de otro año', () => {
    expect(formatMessageTime(local(2025, 12, 31, 23, 59).toISOString(), ahora)).toBe(
      '31 dic 2025, 23:59'
    )
  })

  it('no pinta nada si no hay marca de tiempo o es basura', () => {
    expect(formatMessageTime(undefined, ahora)).toBe('')
    expect(formatMessageTime('', ahora)).toBe('')
    expect(formatMessageTime('no-es-una-fecha', ahora)).toBe('')
  })
})

describe('formatFullTime', () => {
  it('devuelve algo no vacío para una fecha válida y vacío para una inválida', () => {
    expect(formatFullTime(local(2026, 8, 25, 14, 32).toISOString()).length).toBeGreaterThan(0)
    expect(formatFullTime('cualquier cosa')).toBe('')
    expect(formatFullTime(undefined)).toBe('')
  })
})

describe('formatDuration', () => {
  it('usa segundos por debajo del minuto', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(8_400)).toBe('8s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('usa minutos y segundos hasta la hora', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(72_000)).toBe('1m 12s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
  })

  it('a partir de una hora oculta los segundos', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
  })

  it('no inventa duraciones negativas ni con basura', () => {
    expect(formatDuration(-1)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
  })
})

describe('runDuration', () => {
  it('mide contra ahora mientras el agente sigue corriendo', () => {
    expect(runDuration(1_000, undefined, 13_000)).toBe('12s')
  })

  it('congela la duración cuando el agente terminó', () => {
    // el `now` posterior no debe mover el resultado: es lo que separa un
    // cronómetro vivo de la duración final de un agente ya terminado
    expect(runDuration(1_000, 13_000, 999_000)).toBe('12s')
  })

  it('no pinta nada sin inicio conocido', () => {
    expect(runDuration(undefined, undefined, 5_000)).toBe('')
    expect(runDuration(0, undefined, 5_000)).toBe('')
  })
})
