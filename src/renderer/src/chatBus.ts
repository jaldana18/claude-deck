/**
 * Multiplexor de eventos del chat.
 *
 * Todas las pestañas se mantienen montadas (para no perder terminales ni
 * estado), así que si cada ChatView registrara sus ~19 listeners IPC, con N
 * pestañas abiertas cada evento del main cruzaría el puente y ejecutaría
 * 19×N callbacks — durante el streaming son decenas de eventos por segundo.
 *
 * Aquí se suscribe UNA sola vez por canal (perezosamente) y se reparte solo a
 * la pestaña destinataria: el coste deja de crecer con el número de pestañas.
 */

import type {
  ChatMessage,
  ChatResultMeta,
  ModelOption,
  PermissionRequestEvent,
  QuestionRequestEvent,
  SlashCommandInfo,
  TodoItem
} from '../../shared/types'

/** Payload de cada canal (todos llevan tabId: es la clave del reparto) */
export interface ChatPayloads {
  streamStart: { tabId: string; messageId: string }
  delta: { tabId: string; messageId: string; text: string }
  message: { tabId: string; message: ChatMessage }
  toolResult: { tabId: string; toolUseId: string; result: string; isError: boolean }
  result: ChatResultMeta
  error: { tabId: string; message: string }
  permissionRequest: PermissionRequestEvent
  permissionCancel: { tabId: string; requestId: string }
  commands: { tabId: string; commands: SlashCommandInfo[] }
  models: { tabId: string; models: ModelOption[] }
  initModel: { tabId: string; model: string }
  question: QuestionRequestEvent
  questionCancel: { tabId: string; requestId: string }
  todos: { tabId: string; todos: TodoItem[] }
  autoCompact: { tabId: string; phase: 'start' | 'done'; pct: number }
  autoContinue: { tabId: string; count: number }
  subagentBatch: { tabId: string; batches: { parentId: string; messages: ChatMessage[] }[] }
  agentDone: { tabId: string; toolUseId: string; status?: string }
  switched: { tabId: string }
}

export type ChatChannel = keyof ChatPayloads
type Handler = (payload: never) => void

/** Alta del listener real en el puente, una vez por canal */
const REGISTER: Record<ChatChannel, (cb: (p: never) => void) => () => void> = {
  streamStart: (cb) => window.deck.onChatStreamStart(cb as never),
  delta: (cb) => window.deck.onChatDelta(cb as never),
  message: (cb) => window.deck.onChatMessage(cb as never),
  toolResult: (cb) => window.deck.onChatToolResult(cb as never),
  result: (cb) => window.deck.onChatResult(cb as never),
  error: (cb) => window.deck.onChatError(cb as never),
  permissionRequest: (cb) => window.deck.onChatPermissionRequest(cb as never),
  permissionCancel: (cb) => window.deck.onChatPermissionCancel(cb as never),
  commands: (cb) => window.deck.onChatCommands(cb as never),
  models: (cb) => window.deck.onChatModels(cb as never),
  initModel: (cb) => window.deck.onChatInitModel(cb as never),
  question: (cb) => window.deck.onChatQuestion(cb as never),
  questionCancel: (cb) => window.deck.onChatQuestionCancel(cb as never),
  todos: (cb) => window.deck.onChatTodos(cb as never),
  autoCompact: (cb) => window.deck.onChatAutoCompact(cb as never),
  autoContinue: (cb) => window.deck.onChatAutoContinue(cb as never),
  subagentBatch: (cb) => window.deck.onChatSubagentBatch(cb as never),
  agentDone: (cb) => window.deck.onChatAgentDone(cb as never),
  switched: (cb) => window.deck.onChatSwitched(cb as never)
}

/** tabId → handler, por canal */
const subs = new Map<ChatChannel, Map<string, Handler>>()
/** canal → función para dar de baja el listener del puente */
const offs = new Map<ChatChannel, () => void>()

function ensureChannel(channel: ChatChannel): Map<string, Handler> {
  let byTab = subs.get(channel)
  if (byTab) return byTab
  byTab = new Map()
  subs.set(channel, byTab)
  offs.set(
    channel,
    REGISTER[channel]((payload: never) => {
      const tabId = (payload as unknown as { tabId?: string }).tabId
      if (!tabId) return
      subs.get(channel)?.get(tabId)?.(payload)
    })
  )
  return byTab
}

/**
 * Suscribe los handlers de una pestaña. Devuelve la función de baja: al
 * quedarse un canal sin suscriptores se libera también su listener IPC.
 */
export function subscribeChat(
  tabId: string,
  handlers: { [K in ChatChannel]?: (payload: ChatPayloads[K]) => void }
): () => void {
  const entries = Object.entries(handlers) as [ChatChannel, Handler][]
  for (const [channel, handler] of entries) ensureChannel(channel).set(tabId, handler)
  return () => {
    for (const [channel] of entries) {
      const byTab = subs.get(channel)
      byTab?.delete(tabId)
      if (byTab && byTab.size === 0) {
        offs.get(channel)?.()
        offs.delete(channel)
        subs.delete(channel)
      }
    }
  }
}
