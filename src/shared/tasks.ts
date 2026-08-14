import type { TodoItem } from './types'

/**
 * Espejo del plan de tareas de Claude Code. Hay dos mecanismos según versión
 * del CLI y hay que soportar ambos o el widget de Tareas se queda vacío:
 *
 * - `TodoWrite`: manda la lista completa en cada llamada (reemplaza todo).
 * - `TaskCreate` / `TaskUpdate`: incremental. El id real de una tarea recién
 *   creada no viene en la llamada sino en su tool_result («Task #12 created…»),
 *   así que las creaciones quedan pendientes hasta que llega ese resultado.
 */
export class TaskMirror {
  private tasks = new Map<string, TodoItem>()
  private pending = new Map<string, TodoItem>()

  /** Lista completa (TodoWrite): reemplaza el plan entero */
  applyTodoWrite(todos: TodoItem[]): void {
    this.tasks.clear()
    todos.forEach((t, i) => this.tasks.set(`todo-${i}`, { ...t }))
  }

  /** TaskCreate visto: se guarda a la espera del id que traerá su resultado */
  noteCreate(toolUseId: string, input: { subject?: string; activeForm?: string }): void {
    this.pending.set(toolUseId, {
      content: input.subject ?? '(tarea)',
      ...(input.activeForm ? { activeForm: input.activeForm } : {}),
      status: 'pending'
    })
  }

  /**
   * Resultado de un TaskCreate: extrae el id («Task #12 created…») y registra
   * la tarea. Devuelve true si el plan cambió.
   */
  resolveCreate(toolUseId: string, resultText: string): boolean {
    const task = this.pending.get(toolUseId)
    if (!task) return false
    this.pending.delete(toolUseId)
    const id = resultText.match(/#(\d+)/)?.[1] ?? `t${this.tasks.size + 1}`
    this.tasks.set(id, task)
    return true
  }

  /** TaskUpdate: cambia estado/título o elimina. Devuelve true si cambió algo */
  applyUpdate(input: {
    taskId?: string | number
    status?: string
    subject?: string
    activeForm?: string
  }): boolean {
    const id = String(input.taskId ?? '')
    if (!id) return false
    if (input.status === 'deleted') return this.tasks.delete(id)
    const prev = this.tasks.get(id) ?? {
      content: input.subject ?? `#${id}`,
      status: 'pending' as const
    }
    this.tasks.set(id, {
      ...prev,
      ...(input.subject ? { content: input.subject } : {}),
      ...(input.activeForm ? { activeForm: input.activeForm } : {}),
      status: (input.status as TodoItem['status']) ?? prev.status
    })
    return true
  }

  /** Plan actual, en el orden en que aparecieron las tareas */
  list(): TodoItem[] {
    return [...this.tasks.values()]
  }
}
