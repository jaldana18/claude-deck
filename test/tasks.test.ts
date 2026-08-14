import { describe, expect, it } from 'vitest'
import { TaskMirror } from '../src/shared/tasks'

/**
 * Bug real: el widget de Tareas quedaba vacío porque la app solo escuchaba
 * TodoWrite y las versiones actuales de Claude Code planifican con
 * TaskCreate/TaskUpdate. Estos tests cubren ambos mecanismos.
 */
describe('TaskMirror con TodoWrite (lista completa)', () => {
  it('refleja la lista tal cual llega', () => {
    const m = new TaskMirror()
    m.applyTodoWrite([
      { content: 'Arreglar scroll', status: 'in_progress', activeForm: 'Arreglando scroll' },
      { content: 'Publicar release', status: 'pending' }
    ])
    expect(m.list()).toHaveLength(2)
    expect(m.list()[0].status).toBe('in_progress')
  })

  it('cada llamada REEMPLAZA el plan (no acumula duplicados)', () => {
    const m = new TaskMirror()
    m.applyTodoWrite([{ content: 'A', status: 'pending' }])
    m.applyTodoWrite([{ content: 'A', status: 'completed' }])
    expect(m.list()).toEqual([{ content: 'A', status: 'completed' }])
  })
})

describe('TaskMirror con TaskCreate/TaskUpdate (incremental)', () => {
  it('la tarea aparece cuando su resultado trae el id', () => {
    const m = new TaskMirror()
    m.noteCreate('tool-1', { subject: 'Migrar widgets', activeForm: 'Migrando widgets' })
    // aún no visible: falta el id real que llega en el tool_result
    expect(m.list()).toHaveLength(0)
    expect(m.resolveCreate('tool-1', 'Task #22 created successfully: Migrar widgets')).toBe(true)
    expect(m.list()).toEqual([
      { content: 'Migrar widgets', activeForm: 'Migrando widgets', status: 'pending' }
    ])
  })

  it('ignora resultados de tools que no eran TaskCreate', () => {
    const m = new TaskMirror()
    expect(m.resolveCreate('otro-tool', 'algo')).toBe(false)
    expect(m.list()).toHaveLength(0)
  })

  it('TaskUpdate cambia el estado de la tarea correcta', () => {
    const m = new TaskMirror()
    m.noteCreate('t1', { subject: 'Uno' })
    m.resolveCreate('t1', 'Task #1 created')
    m.noteCreate('t2', { subject: 'Dos' })
    m.resolveCreate('t2', 'Task #2 created')

    m.applyUpdate({ taskId: '2', status: 'in_progress' })
    const list = m.list()
    expect(list[0]).toMatchObject({ content: 'Uno', status: 'pending' })
    expect(list[1]).toMatchObject({ content: 'Dos', status: 'in_progress' })
  })

  it('acepta taskId numérico (como lo manda el CLI)', () => {
    const m = new TaskMirror()
    m.noteCreate('t1', { subject: 'Uno' })
    m.resolveCreate('t1', 'Task #7 created')
    expect(m.applyUpdate({ taskId: 7, status: 'completed' })).toBe(true)
    expect(m.list()[0].status).toBe('completed')
  })

  it('status «deleted» quita la tarea del plan', () => {
    const m = new TaskMirror()
    m.noteCreate('t1', { subject: 'Temporal' })
    m.resolveCreate('t1', 'Task #3 created')
    m.applyUpdate({ taskId: '3', status: 'deleted' })
    expect(m.list()).toHaveLength(0)
  })

  it('conserva el orden de creación tras varias actualizaciones', () => {
    const m = new TaskMirror()
    ;['A', 'B', 'C'].forEach((s, i) => {
      m.noteCreate(`t${i}`, { subject: s })
      m.resolveCreate(`t${i}`, `Task #${i + 1} created`)
    })
    m.applyUpdate({ taskId: '1', status: 'completed' })
    m.applyUpdate({ taskId: '3', status: 'in_progress' })
    expect(m.list().map((t) => t.content)).toEqual(['A', 'B', 'C'])
  })

  it('no pierde la tarea si el resultado no trae id parseable', () => {
    const m = new TaskMirror()
    m.noteCreate('t1', { subject: 'Sin id' })
    expect(m.resolveCreate('t1', 'creada')).toBe(true)
    expect(m.list()).toHaveLength(1)
  })
})
