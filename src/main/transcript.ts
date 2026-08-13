import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { ChatMessage } from '../shared/types'
import { toChatMessage } from './chatSession'

/**
 * Historial de una sesión para repintar el chat al reabrir la pestaña.
 * Usa el parser oficial del SDK sobre el .jsonl de ~/.claude/projects.
 */
export async function loadChatHistory(
  sessionId: string,
  cwd: string,
  limit = 400
): Promise<ChatMessage[]> {
  try {
    const messages = await getSessionMessages(sessionId, { dir: cwd })
    const out: ChatMessage[] = []
    const toolResults = new Map<string, { result: string; isError: boolean }>()

    for (const m of messages) {
      if (m.parent_tool_use_id) continue // subagentes fuera del hilo principal
      if (m.type === 'assistant') {
        const chat = toChatMessage(m.uuid, m.message)
        if (chat) out.push(chat)
      } else if (m.type === 'user') {
        const content = (m.message as { content?: unknown }).content
        if (typeof content === 'string') {
          const text = cleanUserText(content)
          if (text) {
            out.push({ id: m.uuid, role: 'user', text, toolUses: [] })
          }
        } else if (Array.isArray(content)) {
          let text = ''
          const images: string[] = []
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              text += (text ? '\n' : '') + block.text
            } else if (block?.type === 'image' && block.source?.type === 'base64') {
              images.push(`data:${block.source.media_type};base64,${block.source.data}`)
            } else if (block?.type === 'tool_result') {
              toolResults.set(String(block.tool_use_id), {
                result: extractText(block.content).slice(0, 4000),
                isError: Boolean(block.is_error)
              })
            }
          }
          const cleaned = cleanUserText(text)
          if (cleaned || images.length > 0) {
            out.push({
              id: m.uuid,
              role: 'user',
              text: cleaned,
              toolUses: [],
              ...(images.length ? { images } : {})
            })
          }
        }
      }
    }

    // adjuntar resultados a sus tool uses
    for (const msg of out) {
      for (const tu of msg.toolUses) {
        const res = toolResults.get(tu.id)
        if (res) {
          tu.result = res.result
          tu.isError = res.isError
        }
      }
    }
    return out.slice(-limit)
  } catch (err) {
    console.error('loadChatHistory:', err)
    return []
  }
}

/**
 * Limpia los envoltorios internos con que Claude Code guarda mensajes en el
 * transcript (la TUI también los oculta):
 * - <command-name>/x</command-name>… → se muestra como el comando limpio "/x args"
 * - <local-command-stdout>, <system-reminder>, etc. → no son mensajes del usuario: se omiten
 * Devuelve '' cuando el mensaje no debe pintarse.
 */
function cleanUserText(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>/)
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? ''
    return `${cmd[1].trim()}${args ? ` ${args}` : ''}`
  }
  const SYSTEM_PREFIXES = [
    '<system-reminder>',
    '<local-command-stdout>',
    '<local-command-stderr>',
    '<task-notification>',
    '[SYSTEM NOTIFICATION',
    '[Request interrupted',
    'Caveat:'
  ]
  if (SYSTEM_PREFIXES.some((p) => text.startsWith(p))) return ''
  // Notificaciones internas incrustadas tras texto real: recortarlas
  const notifIdx = text.indexOf('<task-notification>')
  if (notifIdx > 0) return text.slice(0, notifIdx).trim()
  return text
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b?.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('\n')
  }
  return ''
}
