import { describe, expect, it } from 'vitest'
import { extractJsonBlock, parseEnv, slugify, splitArgs } from '../src/shared/parse'

describe('extractJsonBlock (preámbulo de los MCP)', () => {
  // Bug real: el MCP de azure-devops antepone texto al JSON y el board salía vacío
  it('extrae el array JSON tras un preámbulo de texto', () => {
    const raw = 'Project: FacturaElectronica, Team: Equipo Web\n[{"id":1,"name":"Sprint 01"}]'
    expect(JSON.parse(extractJsonBlock(raw)!)).toEqual([{ id: 1, name: 'Sprint 01' }])
  })

  it('extrae un objeto JSON con texto antes y después', () => {
    const raw = 'Resultado:\n{"value":[{"id":7}]}\n-- fin --'
    expect(JSON.parse(extractJsonBlock(raw)!)).toEqual({ value: [{ id: 7 }] })
  })

  it('elige el bloque correcto cuando hay llaves y corchetes', () => {
    const raw = 'x { no json } luego [1,2,3]'
    // el primer delimitador es '{' → toma desde ahí hasta la última llave
    expect(extractJsonBlock(raw)).toContain('{ no json }')
  })

  it('devuelve null cuando no hay JSON', () => {
    expect(extractJsonBlock('sin datos')).toBeNull()
    expect(extractJsonBlock('')).toBeNull()
  })
})

describe('splitArgs (argumentos de servidores MCP)', () => {
  it('separa por espacios', () => {
    expect(splitArgs('-y @azure-devops/mcp eliderar --authentication pat')).toEqual([
      '-y',
      '@azure-devops/mcp',
      'eliderar',
      '--authentication',
      'pat'
    ])
  })

  it('respeta rutas con espacios entre comillas', () => {
    expect(splitArgs('-y server "C:\\Mis Documentos\\proyecto"')).toEqual([
      '-y',
      'server',
      'C:\\Mis Documentos\\proyecto'
    ])
    expect(splitArgs("run 'ruta con espacios'")).toEqual(['run', 'ruta con espacios'])
  })

  it('devuelve vacío para cadena vacía', () => {
    expect(splitArgs('   ')).toEqual([])
  })
})

describe('parseEnv (variables de los MCP)', () => {
  it('lee pares CLAVE=valor por línea', () => {
    expect(parseEnv('TOKEN=abc123\nURL=https://x.com')).toEqual({
      TOKEN: 'abc123',
      URL: 'https://x.com'
    })
  })

  it('conserva los «=» del valor (tokens base64, connection strings)', () => {
    expect(parseEnv('KEY=abc==')).toEqual({ KEY: 'abc==' })
  })

  it('ignora líneas sin clave', () => {
    expect(parseEnv('\n=solovalor\nOK=1')).toEqual({ OK: '1' })
  })
})

describe('slugify (nombres de agentes, skills y comandos)', () => {
  it('normaliza acentos y espacios a kebab-case', () => {
    expect(slugify('Revisión de Código')).toBe('revision-de-codigo')
    expect(slugify('facturación electrónica')).toBe('facturacion-electronica')
  })

  it('evita nombres de archivo inválidos', () => {
    expect(slugify('a/b\\c:d')).toBe('a-b-c-d')
    expect(slugify('---')).toBe('sin-nombre')
    expect(slugify('')).toBe('sin-nombre')
  })
})
