import { describe, it, expect } from 'vitest'
import {
  diffStats,
  groupToolUses,
  computeTurnChanges,
  parseSystemNotice,
  liveStateFor,
  relPath,
  toolInput,
  isTestCommand,
  type RichToolUse
} from '../src/renderer/src/components/chat/logic'
import type { ChatMessage } from '../src/shared/types'

let n = 0
const tu = (name: string, input: Record<string, unknown>, extra: Partial<RichToolUse> = {}): RichToolUse => ({
  id: `t${++n}`,
  name,
  input: JSON.stringify(input, null, 2),
  result: 'ok',
  ...extra
})
const msg = (toolUses: RichToolUse[], role: ChatMessage['role'] = 'assistant'): ChatMessage => ({
  id: `m${++n}`,
  role,
  text: '',
  toolUses
})

describe('diffStats', () => {
  it('cuenta solo las líneas que cambian en un Edit', () => {
    const t = tu('Edit', { file_path: 'a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' })
    expect(diffStats(t)).toEqual({ added: 2, removed: 1 })
  })
  it('Write cuenta todo como añadido', () => {
    expect(diffStats(tu('Write', { file_path: 'a.ts', content: 'x\ny\nz\n' }))).toEqual({ added: 3, removed: 0 })
  })
  it('suma los edits de un MultiEdit', () => {
    const t = tu('MultiEdit', {
      file_path: 'a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c\nd', new_string: '' }
      ]
    })
    expect(diffStats(t)).toEqual({ added: 1, removed: 3 })
  })
  it('null para tools que no editan', () => {
    expect(diffStats(tu('Bash', { command: 'ls' }))).toBeNull()
  })
  it('usa inputObj si viene', () => {
    const t: RichToolUse = { id: 'x', name: 'Write', input: '', inputObj: { file_path: 'a', content: 'q\nw' } }
    expect(diffStats(t)).toEqual({ added: 2, removed: 0 })
  })
  it('rescata campos de un input JSON recortado', () => {
    const full = JSON.stringify({ file_path: 'C:/p/a.ts', old_string: 'uno', new_string: 'dos\ntres\ncuatro' }, null, 2)
    const t: RichToolUse = { id: 'y', name: 'Edit', input: full.slice(0, full.length - 8) + '\n…' }
    const parsed = toolInput(t)
    expect(parsed.truncated).toBe(true)
    expect(parsed.obj.file_path).toBe('C:/p/a.ts')
    expect(diffStats(t)?.removed).toBe(1)
  })
})

describe('groupToolUses', () => {
  it('agrupa rachas de ≥3 lecturas y oculta los de tareas', () => {
    const items = groupToolUses([
      tu('Read', { file_path: 'a' }),
      tu('TodoWrite', {}),
      tu('Grep', { pattern: 'x' }),
      tu('Glob', { pattern: '*.ts' }),
      tu('Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }),
      tu('Read', { file_path: 'b' }),
      tu('Read', { file_path: 'c' })
    ])
    expect(items.map((i) => i.kind)).toEqual(['group', 'tool', 'tool', 'tool'])
    const g = items[0]
    expect(g.kind === 'group' && [g.files, g.searches]).toEqual([1, 2])
  })
  it('no agrupa menos de tres', () => {
    expect(groupToolUses([tu('Read', {}), tu('Read', {})]).every((i) => i.kind === 'tool')).toBe(true)
  })
})

describe('computeTurnChanges', () => {
  it('agrega por archivo, ignora errores y detecta tests', () => {
    const { changes, tests } = computeTurnChanges([
      msg([
        tu('Edit', { file_path: 'C:\\p\\a.ts', old_string: 'a', new_string: 'b' }),
        tu('Bash', { command: 'npm test' }, { isError: true })
      ]),
      msg([
        tu('Edit', { file_path: 'C:/p/a.ts', old_string: 'c', new_string: 'd\ne' }),
        tu('Write', { file_path: 'C:/p/b.ts', content: '1\n2' }),
        tu('Edit', { file_path: 'C:/p/z.ts', old_string: 'a', new_string: 'b' }, { isError: true }),
        tu('Bash', { command: 'npx vitest run' })
      ])
    ])
    expect(changes).toEqual([
      { path: 'C:\\p\\a.ts', added: 3, removed: 2, kind: 'edit' },
      { path: 'C:/p/b.ts', added: 2, removed: 0, kind: 'write' }
    ])
    expect(tests).toBe('pass')
  })
  it('tests null si no hubo comando de tests', () => {
    expect(computeTurnChanges([msg([tu('Bash', { command: 'git status' })])]).tests).toBeNull()
  })
  it('reconoce comandos de tests habituales', () => {
    for (const c of ['npm run test', 'pytest -q', 'dotnet test', 'go test ./...', 'cargo test', 'pnpm test:unit'])
      expect(isTestCommand(c)).toBe(true)
    expect(isTestCommand('npm run build')).toBe(false)
  })
})

describe('parseSystemNotice', () => {
  it('reconoce los avisos de ChatView', () => {
    expect(parseSystemNotice('⟳ Auto-compact (1/3): el contexto llegó a 150k tokens — compactando la conversación…'))
      .toEqual({ tone: 'info', text: 'Auto-compact (1/3): el contexto llegó a 150k tokens — compactando la conversación…' })
    expect(parseSystemNotice('⟳ Compact terminado: retomando el proceso si había uno en curso.')?.tone).toBe('info')
    expect(parseSystemNotice('⚠ Auto-compact detenido: ya se hicieron 3 compactaciones')?.tone).toBe('warn')
    expect(parseSystemNotice('⟳ Continuación automática (2/5): retomando donde quedó.')?.text).toBe(
      'Continuación automática (2/5): retomando donde quedó.'
    )
  })
  it('null para texto normal', () => {
    expect(parseSystemNotice('hola, ⟳ Auto-compact')).toBeNull()
    expect(parseSystemNotice('')).toBeNull()
  })
})

describe('liveStateFor / relPath', () => {
  it('describe el último tool pendiente', () => {
    const st = liveStateFor([msg([tu('Bash', { command: 'npm test' }, { result: undefined })])])
    expect(st.label).toBe('Ejecutando')
    expect(st.code).toBe('npm test')
  })
  it('pensando si no hay nada pendiente', () => {
    expect(liveStateFor([msg([], 'user')]).key).toBe('thinking')
  })
  it('ruta relativa al cwd', () => {
    expect(relPath('C:\\Proj\\src\\a.ts', 'c:/proj')).toBe('src/a.ts')
    expect(relPath('D:/otro/a.ts', 'C:/proj')).toBe('D:/otro/a.ts')
  })
})
