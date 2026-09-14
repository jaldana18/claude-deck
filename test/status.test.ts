import { describe, expect, it } from 'vitest'
import {
  familiasCitadas,
  fallosVigentes,
  modelosDegradados,
  nivelDeComponente,
  nivelGlobal,
  nuevoFallo,
  resumirEstado
} from '../src/shared/status'
import type { ModelFault } from '../src/shared/types'

const AHORA = 1_800_000_000_000

/** n fallos del mismo modelo, todos dentro de la ventana */
function fallos(model: string, n: number, desdeMs = 0): ModelFault[] {
  return Array.from({ length: n }, (_, i) => nuevoFallo(model, 529, 'overloaded', AHORA - desdeMs - i))
}

describe('nivelDeComponente', () => {
  it('traduce las etiquetas de Statuspage', () => {
    expect(nivelDeComponente('operational')).toBe('operational')
    expect(nivelDeComponente('degraded_performance')).toBe('degraded')
    expect(nivelDeComponente('partial_outage')).toBe('partial')
    expect(nivelDeComponente('major_outage')).toBe('major')
    expect(nivelDeComponente('under_maintenance')).toBe('maintenance')
  })

  it('no adivina ante una etiqueta nueva', () => {
    expect(nivelDeComponente('algo_que_no_existe')).toBe('unknown')
  })
})

describe('nivelGlobal', () => {
  it('usa la escala del indicador, distinta a la de los componentes', () => {
    // 'major' como indicador global NO es lo mismo que 'major_outage'
    expect(nivelGlobal('none')).toBe('operational')
    expect(nivelGlobal('minor')).toBe('degraded')
    expect(nivelGlobal('major')).toBe('partial')
    expect(nivelGlobal('critical')).toBe('major')
  })
})

describe('familiasCitadas', () => {
  it('saca los modelos del texto del incidente', () => {
    expect(familiasCitadas('Elevated errors on Claude Opus')).toEqual(['opus'])
    expect(familiasCitadas('Degraded performance for Sonnet and Haiku').sort()).toEqual([
      'haiku',
      'sonnet'
    ])
  })

  it('no devuelve nada cuando el parte no nombra ningún modelo', () => {
    expect(familiasCitadas('Elevated error rates on the API')).toEqual([])
  })

  it('exige palabra completa, para no confundirse con otras palabras', () => {
    expect(familiasCitadas('opusculo')).toEqual([])
  })
})

describe('modelosDegradados', () => {
  it('no avisa por debajo del umbral: un 529 suelto no es una caída', () => {
    expect(modelosDegradados(fallos('opus', 2), 3, AHORA)).toEqual([])
  })

  it('avisa al alcanzar el umbral', () => {
    expect(modelosDegradados(fallos('opus', 3), 3, AHORA)).toEqual(['opus'])
  })

  it('cuenta cada modelo por separado', () => {
    const mezcla = [...fallos('opus', 3), ...fallos('sonnet', 1)]
    expect(modelosDegradados(mezcla, 3, AHORA)).toEqual(['opus'])
  })

  it('olvida los fallos que salieron de la ventana', () => {
    const viejos = fallos('opus', 5, 11 * 60 * 1000)
    expect(modelosDegradados(viejos, 3, AHORA)).toEqual([])
  })
})

describe('fallosVigentes', () => {
  it('conserva los de dentro y descarta los de fuera', () => {
    const mezcla = [...fallos('opus', 2), ...fallos('sonnet', 2, 11 * 60 * 1000)]
    const vivos = fallosVigentes(mezcla, AHORA)
    expect(vivos).toHaveLength(2)
    expect(vivos.every((f) => f.model === 'opus')).toBe(true)
  })
})

describe('nuevoFallo', () => {
  it('resuelve la familia y recorta mensajes largos', () => {
    const f = nuevoFallo('claude-opus-4-6', 529, 'x'.repeat(500), AHORA)
    expect(f.family).toBe('opus')
    expect(f.message).toHaveLength(200)
  })

  it('sin modelo explícito, el fallo se atribuye al default de la cuenta', () => {
    expect(nuevoFallo(undefined, null, 'timeout', AHORA).model).toBe('default')
  })
})

describe('resumirEstado', () => {
  const base = {
    checkedAt: AHORA,
    level: 'operational' as const,
    summary: 'All Systems Operational',
    components: [],
    incidents: [],
    faults: [],
    degraded: []
  }

  it('calla cuando no hay nada que decir', () => {
    expect(resumirEstado(null)).toBeNull()
    expect(resumirEstado(base)).toBeNull()
  })

  it('avisa de una degradación local aunque el status oficial diga que todo va bien', () => {
    // Este es el caso que motiva toda la función: Anthropic tarda en abrir
    // incidente, pero tú ya llevas cinco 529 seguidos.
    const r = resumirEstado({ ...base, degraded: ['claude-opus-4-6'], faults: fallos('claude-opus-4-6', 5) })
    expect(r).not.toBeNull()
    expect(r!.texto).toContain('Opus 4.6')
    expect(r!.texto).toContain('5 errores')
    expect(r!.texto).toContain('no reporta ninguna incidencia todavía')
  })

  it('un incidente oficial resuelto no genera aviso', () => {
    const r = resumirEstado({
      ...base,
      incidents: [
        {
          id: 'i1',
          name: 'Elevated errors',
          stage: 'resolved',
          impact: 'major',
          url: 'https://status.claude.com/i1',
          startedAt: '',
          families: ['opus']
        }
      ]
    })
    expect(r).toBeNull()
  })

  it('sube el tono a grave con un incidente de impacto mayor', () => {
    const r = resumirEstado({
      ...base,
      incidents: [
        {
          id: 'i2',
          name: 'API outage',
          stage: 'investigating',
          impact: 'critical',
          url: 'https://status.claude.com/i2',
          startedAt: '',
          families: ['opus', 'sonnet']
        }
      ]
    })
    expect(r!.tono).toBe('grave')
    expect(r!.texto).toContain('afecta a opus, sonnet')
    expect(r!.url).toBe('https://status.claude.com/i2')
  })

  it('la firma cambia cuando cambia la situación, para poder descartar el aviso', () => {
    const a = resumirEstado({ ...base, degraded: ['opus'], faults: fallos('opus', 3) })
    const b = resumirEstado({ ...base, degraded: ['opus', 'sonnet'], faults: fallos('opus', 3) })
    expect(a!.firma).not.toBe(b!.firma)
  })
})
