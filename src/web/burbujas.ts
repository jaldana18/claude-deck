import type { ChatMessage, ChatToolUse } from '../shared/types'
import { el, recorta, textoRico } from './dom'

/**
 * Cómo se pinta un mensaje. Vive aparte porque lo usan la conversación viva y el
 * historial de una sesión pasada, y un mensaje viejo tiene que verse igual que
 * uno de ahora: si divergieran, la misma conversación se leería distinta según
 * por dónde se entre.
 *
 * `abiertos` recuerda qué herramientas están desplegadas, para que un repintado
 * no las cierre.
 */
export function burbuja(m: ChatMessage, abiertos: Set<string>): HTMLElement {
  const b = el('div', `burbuja ${m.role}`)
  if (m.text.trim()) b.append(textoRico(m.text))
  for (const img of m.images ?? []) {
    const i = el('img', 'adjunto')
    i.src = img
    i.alt = 'Imagen adjunta'
    b.append(i)
  }
  for (const u of m.toolUses) b.append(lineaHerramienta(u, abiertos))
  return b
}

function lineaHerramienta(u: ChatToolUse, abiertos: Set<string>): HTMLElement {
  const d = el('details', 'tool')
  d.open = abiertos.has(u.id)
  const s = el('summary', 'tool-linea')
  s.append(el('span', 'tool-nombre', u.name), el('span', 'tool-arg', recorta(resumenEntrada(u.input), 48)))
  if (u.isError) s.append(el('span', 'chip error', 'error'))
  else if (u.result === undefined) s.append(el('span', 'chip', '…'))
  d.append(s, el('pre', 'tool-cuerpo', recorta(u.input, 2000)))
  if (u.result !== undefined) {
    d.append(el('pre', u.isError ? 'tool-cuerpo malo' : 'tool-cuerpo', recorta(u.result, 4000)))
  }
  d.addEventListener('toggle', () => {
    if (d.open) abiertos.add(u.id)
    else abiertos.delete(u.id)
  })
  return d
}

/** Lo que cambia de un mensaje y obliga a repintarlo. */
export function firmaMensaje(m: ChatMessage): string {
  const usos = m.toolUses.map((u) => `${u.id}:${u.result?.length ?? -1}:${u.isError ? 1 : 0}`).join(',')
  return `${m.text.length}:${m.streaming ? 1 : 0}:${(m.images ?? []).length}:${usos}`
}

const CLAVES_RESUMEN = ['file_path', 'command', 'path', 'pattern', 'url', 'description', 'prompt']

/** El argumento que dice de un vistazo qué hace la herramienta. */
function resumenEntrada(input: string): string {
  try {
    const datos = JSON.parse(input) as Record<string, unknown>
    for (const clave of CLAVES_RESUMEN) {
      const v = datos[clave]
      if (typeof v === 'string' && v) return v.replace(/\s+/g, ' ')
    }
  } catch {
    /* no siempre es JSON */
  }
  return input.replace(/\s+/g, ' ')
}
