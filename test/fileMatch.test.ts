import { describe, expect, it } from 'vitest'
import { rankFiles, scorePath } from '../src/shared/fileMatch'

const FILES = [
  'src/main/chatSession.ts',
  'src/main/index.ts',
  'src/renderer/src/components/ChatView.tsx',
  'src/shared/types.ts',
  'test/chatSessionLoop.test.ts',
  'docs/very/deep/folder/structure/chat.md',
  'README.md'
]

describe('rankFiles', () => {
  it('casa por subsecuencia sin distinguir mayúsculas', () => {
    expect(rankFiles(FILES, 'CHTSES')).toContain('src/main/chatSession.ts')
    expect(rankFiles(FILES, 'zzz')).toEqual([])
  })

  it('prioriza el match en el nombre del archivo sobre el de las carpetas', () => {
    const r = rankFiles(['main/other/x.ts', 'lib/main.ts'], 'main')
    expect(r[0]).toBe('lib/main.ts')
  })

  it('a igualdad de match gana la ruta más corta', () => {
    const r = rankFiles(['a/b/c/index.ts', 'a/index.ts', 'index.ts'], 'index')
    expect(r).toEqual(['index.ts', 'a/index.ts', 'a/b/c/index.ts'])
  })

  it('el prefijo del basename pesa más que un match disperso', () => {
    const r = rankFiles(FILES, 'chat')
    expect(r[0]).toBe('docs/very/deep/folder/structure/chat.md')
    expect(r[1]).toBe('src/main/chatSession.ts')
    expect(r.indexOf('src/renderer/src/components/ChatView.tsx')).toBeLessThan(
      r.indexOf('src/shared/types.ts') === -1 ? Infinity : r.indexOf('src/shared/types.ts')
    )
  })

  it('acepta consultas con carpeta y barra invertida', () => {
    expect(rankFiles(FILES, 'shared\\types')[0]).toBe('src/shared/types.ts')
    expect(rankFiles(FILES, 'main/index')[0]).toBe('src/main/index.ts')
  })

  it('consulta vacía: devuelve las rutas más cortas primero', () => {
    expect(rankFiles(FILES, '  ')[0]).toBe('README.md')
  })

  it('respeta el límite', () => {
    const many = Array.from({ length: 200 }, (_, i) => `f${i}.ts`)
    expect(rankFiles(many, 'f')).toHaveLength(50)
    expect(rankFiles(many, 'f', 5)).toHaveLength(5)
  })
})

describe('scorePath', () => {
  it('null si la consulta no es subsecuencia', () => {
    expect(scorePath('src/a.ts', 'xyz')).toBeNull()
  })
})
