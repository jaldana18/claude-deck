import type {
  ChatHealth,
  ChatMessage,
  ModelOption,
  OwnerState,
  PermissionRequestEvent,
  QuestionRequestEvent,
  SessionSnapshot,
  SlashCommandInfo,
  TabState,
  TabStatus,
  TodoItem
} from '../shared/types'
import * as api from './api'

/**
 * Estado del cliente: una copia local de lo que el PC va contando por el flujo
 * de eventos. Las vistas leen de aquí y se enteran de los cambios por tema, de
 * modo que un delta de una conversación no repinta el resto de la app.
 */

export interface EntradaTab {
  tab: TabState
  snapshot: SessionSnapshot | null
  owner: OwnerState | null
  status: TabStatus | null
  /** Último error de la sesión, para verlo también desde el panel. */
  error: string | null
  aviso: string | null
}

export interface EstadoChat {
  mensajes: ChatMessage[]
  cargando: boolean
  cargado: boolean
}

/** Versión con la que se compiló este cliente. */
export const VERSION = __VERSION__

export const TEMA_CONEXION = 'conexion'
export const TEMA_TABS = 'tabs'
export function temaChat(tabId: string): string {
  return `chat:${tabId}`
}

function saludVacia(tabId: string): ChatHealth {
  return { tabId, contextTokens: 0, contextWindow: 0, outputTokens: 0, costUsd: 0, numTurns: 0 }
}

function snapshotVacio(tabId: string): SessionSnapshot {
  return {
    tabId,
    busy: false,
    streaming: null,
    permissions: [],
    questions: [],
    todos: [],
    health: saludVacia(tabId),
    commands: [],
    models: []
  }
}

class Tienda {
  conectado = false
  /** Versión que dice tener el PC, la misma o no. */
  versionPC: string | null = null

  /** La del PC cuando no es la de este cliente: hay que recargar para igualarla. */
  get versionNueva(): string | null {
    return this.versionPC && this.versionPC !== VERSION ? this.versionPC : null
  }
  /** Último seq recibido: es lo que se pide al reconectar. */
  ultimoSeq = 0
  miClientId = api.sesion()?.clientId ?? ''
  lista: EntradaTab[] = []
  chats = new Map<string, EstadoChat>()
  /** Aviso de que hace falta atender algo; lo usa la notificación del sistema. */
  alAtencion: ((tabId: string, titulo: string, cuerpo: string) => void) | null = null

  private oyentes = new Set<(temas: Set<string>) => void>()
  private pendientes = new Set<string>()
  private programado = false

  escuchar(fn: (temas: Set<string>) => void): () => void {
    this.oyentes.add(fn)
    return () => this.oyentes.delete(fn)
  }

  marcar(...temas: string[]): void {
    for (const t of temas) this.pendientes.add(t)
    if (this.programado) return
    this.programado = true
    requestAnimationFrame(() => {
      this.programado = false
      const lote = this.pendientes
      this.pendientes = new Set()
      for (const fn of [...this.oyentes]) fn(lote)
    })
  }

  entrada(tabId: string): EntradaTab | null {
    return this.lista.find((e) => e.tab.id === tabId) ?? null
  }

  /** Solo las conversaciones: una pestaña de terminal no se maneja desde fuera. */
  conversaciones(): EntradaTab[] {
    return this.lista.filter((e) => e.tab.mode === 'chat')
  }

  terminales(): number {
    return this.lista.length - this.conversaciones().length
  }

  /**
   * ¿Puede este dispositivo enviar y aprobar aquí? Misma regla que el PC: manda
   * quien tomó el control, y un dueño desconectado no bloquea a nadie.
   */
  tieneControl(tabId: string): boolean {
    const o = this.entrada(tabId)?.owner
    if (!o || !o.connected) return true
    return o.clientId === this.miClientId
  }

  chat(tabId: string): EstadoChat {
    let c = this.chats.get(tabId)
    if (!c) {
      c = { mensajes: [], cargando: false, cargado: false }
      this.chats.set(tabId, c)
    }
    return c
  }

  // ---------- carga y rehidratación ----------

  /** Todo el estado de golpe: al arrancar y cada vez que se detecta un hueco. */
  async cargarBase(): Promise<void> {
    // Las pestañas se piden aparte y se esperan las tres por separado: si
    // fallara una de las otras dos, un `Promise.all` dejaría la app sin lista de
    // conversaciones, que es justo lo único que siempre se puede mostrar.
    const pestanas = await api.pedirPestanas()
    const [snaps, dues] = await Promise.allSettled([api.pedirSnapshots(), api.pedirDuenos()])
    const snapshots = snaps.status === 'fulfilled' ? snaps.value : []
    const duenos = dues.status === 'fulfilled' ? dues.value : []
    const previas = new Map(this.lista.map((e) => [e.tab.id, e]))
    this.lista = pestanas.tabs.map((tab) => {
      const previa = previas.get(tab.id)
      return {
        tab,
        snapshot: previa?.snapshot ?? null,
        owner: previa?.owner ?? null,
        status: previa?.status ?? null,
        error: previa?.error ?? null,
        aviso: previa?.aviso ?? null
      }
    })
    for (const s of snapshots) {
      const e = this.entrada(s.tabId)
      if (e) e.snapshot = s
    }
    const porTab = new Map(duenos.map((d) => [d.tabId, d]))
    for (const e of this.lista) e.owner = porTab.get(e.tab.id) ?? null

    this.marcar(TEMA_TABS, ...this.lista.map((e) => temaChat(e.tab.id)))
  }

  /** Historial + estado vivo de una conversación que se acaba de abrir. */
  async cargarChat(tabId: string): Promise<void> {
    const c = this.chat(tabId)
    if (c.cargando) return
    c.cargando = true
    this.marcar(temaChat(tabId))
    try {
      const [historial, snapshot] = await Promise.all([
        api.pedirHistorial(tabId),
        api.pedirSnapshot(tabId)
      ])
      // El historial se funde con lo que ya llegó por eventos mientras se pedía:
      // sin esto, un mensaje del mismo instante saldría dos veces.
      const vistos = new Map(historial.map((m) => [m.id, m]))
      for (const m of c.mensajes) vistos.set(m.id, m)
      c.mensajes = [...vistos.values()]
      const e = this.entrada(tabId)
      if (e && snapshot) e.snapshot = snapshot
      c.cargado = true
    } finally {
      c.cargando = false
      this.marcar(temaChat(tabId))
    }
  }

  /** Vuelve a pedir el historial de las conversaciones ya abiertas. */
  async recargarAbiertos(): Promise<void> {
    for (const [tabId, c] of this.chats) {
      if (!c.cargado) continue
      c.mensajes = []
      c.cargado = false
      await this.cargarChat(tabId).catch(() => undefined)
    }
  }

  // ---------- eventos ----------

  aplicar(channel: string, payload: unknown): void {
    const p = (payload ?? {}) as Record<string, unknown>
    const tabId = typeof p.tabId === 'string' ? p.tabId : ''

    switch (channel) {
      case 'tab:list': {
        const tabs = (p.tabs ?? []) as TabState[]
        const previas = new Map(this.lista.map((e) => [e.tab.id, e]))
        this.lista = tabs.map((tab) => {
          const previa = previas.get(tab.id)
          if (previa) {
            previa.tab = tab
            return previa
          }
          return { tab, snapshot: null, owner: null, status: null, error: null, aviso: null }
        })
        this.marcar(TEMA_TABS)
        return
      }
      case 'tab:state': {
        const e = this.entrada(tabId)
        if (!e) return
        e.tab = { ...e.tab, ...((p.patch ?? {}) as Partial<TabState>) }
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'tab:status': {
        const e = this.entrada(tabId)
        if (!e) return
        e.status = (p.status ?? null) as TabStatus | null
        this.marcar(TEMA_TABS)
        return
      }
      case 'tab:session':
        return
      case 'chat:owner': {
        const e = this.entrada(tabId)
        if (!e) return
        e.owner = (p.owner ?? null) as OwnerState | null
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:stream-start': {
        const s = this.snap(tabId)
        if (!s) return
        s.busy = true
        s.streaming = { messageId: String(p.messageId ?? ''), text: '' }
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:delta': {
        const s = this.snap(tabId)
        if (!s) return
        const messageId = String(p.messageId ?? '')
        if (!s.streaming || s.streaming.messageId !== messageId) {
          s.streaming = { messageId, text: '' }
        }
        s.streaming.text += String(p.text ?? '')
        s.busy = true
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:message': {
        const s = this.snap(tabId)
        if (!s) return
        if (p.replacesStreaming) s.streaming = null
        this.guardarMensaje(tabId, p.message as ChatMessage)
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:tool-result': {
        const c = this.chats.get(tabId)
        if (!c) return
        const id = String(p.toolUseId ?? '')
        for (let i = c.mensajes.length - 1; i >= 0; i -= 1) {
          const uso = c.mensajes[i].toolUses.find((u) => u.id === id)
          if (!uso) continue
          uso.result = String(p.result ?? '')
          uso.isError = Boolean(p.isError)
          break
        }
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:result': {
        const s = this.snap(tabId)
        if (!s) return
        s.busy = false
        s.streaming = null
        if (p.isError && typeof p.errorText === 'string') {
          const e = this.entrada(tabId)
          if (e) e.error = p.errorText
        }
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:error': {
        const s = this.snap(tabId)
        if (s) {
          s.busy = false
          s.streaming = null
        }
        const e = this.entrada(tabId)
        if (e) e.error = String(p.message ?? 'Falló la sesión')
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:health': {
        const s = this.snap(tabId)
        if (!s) return
        s.health = payload as ChatHealth
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:todos': {
        const s = this.snap(tabId)
        if (!s) return
        s.todos = (p.todos ?? []) as TodoItem[]
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:permission-request': {
        const s = this.snap(tabId)
        if (!s) return
        const pedido = payload as PermissionRequestEvent
        s.permissions = [...s.permissions.filter((x) => x.requestId !== pedido.requestId), pedido]
        this.marcar(TEMA_TABS, temaChat(tabId))
        this.alAtencion?.(tabId, 'Permiso pendiente', pedido.title ?? pedido.toolName)
        return
      }
      case 'chat:permission-cancel': {
        const s = this.snap(tabId)
        if (!s) return
        s.permissions = s.permissions.filter((x) => x.requestId !== String(p.requestId ?? ''))
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:question': {
        const s = this.snap(tabId)
        if (!s) return
        const pregunta = payload as QuestionRequestEvent
        s.questions = [...s.questions.filter((x) => x.requestId !== pregunta.requestId), pregunta]
        this.marcar(TEMA_TABS, temaChat(tabId))
        this.alAtencion?.(
          tabId,
          'Claude pregunta',
          pregunta.questions[0]?.question ?? 'Hay una pregunta esperando'
        )
        return
      }
      case 'chat:question-cancel': {
        const s = this.snap(tabId)
        if (!s) return
        s.questions = s.questions.filter((x) => x.requestId !== String(p.requestId ?? ''))
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:commands': {
        const s = this.snap(tabId)
        if (!s) return
        s.commands = (p.commands ?? []) as SlashCommandInfo[]
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:models': {
        const s = this.snap(tabId)
        if (!s) return
        s.models = (p.models ?? []) as ModelOption[]
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:init-model': {
        const s = this.snap(tabId)
        if (!s) return
        s.health = { ...s.health, model: String(p.model ?? '') }
        this.marcar(temaChat(tabId))
        return
      }
      case 'chat:auto-compact': {
        const e = this.entrada(tabId)
        if (!e) return
        const fase = String(p.phase ?? '')
        e.aviso =
          fase === 'start'
            ? 'Compactando el contexto…'
            : fase === 'capped'
              ? 'Tope de compactaciones automáticas alcanzado'
              : null
        this.marcar(TEMA_TABS, temaChat(tabId))
        return
      }
      case 'chat:auto-continue': {
        const e = this.entrada(tabId)
        if (!e) return
        e.aviso = `Continuando sola (${String(p.count ?? '')})`
        this.marcar(temaChat(tabId))
        return
      }
      default:
        return
    }
  }

  /**
   * Al responder, la tarjeta se quita en el acto: el PC no emite ningún evento
   * de «ya contestada», solo de cancelada, así que nadie la va a quitar por
   * nosotros y quedaría ahí prometiendo una decisión ya tomada.
   */
  quitarPermiso(tabId: string, requestId: string): void {
    const s = this.entrada(tabId)?.snapshot
    if (!s) return
    s.permissions = s.permissions.filter((x) => x.requestId !== requestId)
    this.marcar(TEMA_TABS, temaChat(tabId))
  }

  quitarPregunta(tabId: string, requestId: string): void {
    const s = this.entrada(tabId)?.snapshot
    if (!s) return
    s.questions = s.questions.filter((x) => x.requestId !== requestId)
    this.marcar(TEMA_TABS, temaChat(tabId))
  }

  /** Una pestaña recién creada se mete ya: el `tab:list` puede tardar un suspiro. */
  anadirPestana(tab: TabState): void {
    if (this.entrada(tab.id)) return
    this.lista = [...this.lista, { tab, snapshot: null, owner: null, status: null, error: null, aviso: null }]
    this.marcar(TEMA_TABS)
  }

  /** Tras un `sin-control` hay que volver a preguntar quién manda. */
  async refrescarDuenos(): Promise<void> {
    const duenos = await api.pedirDuenos().catch(() => null)
    if (!duenos) return
    const porTab = new Map(duenos.map((d) => [d.tabId, d]))
    for (const e of this.lista) e.owner = porTab.get(e.tab.id) ?? null
    this.marcar(TEMA_TABS, ...this.lista.map((e) => temaChat(e.tab.id)))
  }

  ponerDueno(dueno: OwnerState): void {
    const e = this.entrada(dueno.tabId)
    if (!e) return
    e.owner = dueno
    this.marcar(TEMA_TABS, temaChat(dueno.tabId))
  }

  private snap(tabId: string): SessionSnapshot | null {
    const e = this.entrada(tabId)
    if (!e) return null
    if (!e.snapshot) e.snapshot = snapshotVacio(tabId)
    return e.snapshot
  }

  private guardarMensaje(tabId: string, mensaje: ChatMessage | undefined): void {
    if (!mensaje || typeof mensaje.id !== 'string') return
    // Basta con que la conversación esté abierta: los mensajes que llegan
    // mientras se pide el historial se funden con él al terminar.
    const c = this.chats.get(tabId)
    if (!c) return
    const i = c.mensajes.findIndex((m) => m.id === mensaje.id)
    if (i >= 0) c.mensajes[i] = mensaje
    else c.mensajes.push(mensaje)
  }
}

export const tienda = new Tienda()

// ---------- utilidades de lectura ----------

export function pctContexto(salud: ChatHealth): number {
  if (!salud.contextWindow) return 0
  return Math.min(100, Math.round((salud.contextTokens / salud.contextWindow) * 100))
}

export function atencionPendiente(e: EntradaTab): number {
  return (e.snapshot?.permissions.length ?? 0) + (e.snapshot?.questions.length ?? 0)
}

export function trabajando(e: EntradaTab): boolean {
  return Boolean(e.snapshot?.busy) || e.status === 'working'
}

/** Nombre corto de la carpeta: en el móvil no cabe una ruta de Windows entera. */
export function carpetaCorta(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  return partes.slice(-2).join(' / ') || ruta
}
