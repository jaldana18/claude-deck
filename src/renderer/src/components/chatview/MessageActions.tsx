import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../../shared/types'
import { IconCheck, IconCopy, IconPencil, IconRefresh, IconRewind } from '../Icons'
import { isLocalId, isNoticeId } from './deckExtra'

/**
 * Acciones que la vista expone a las burbujas. Debe ser un objeto ESTABLE
 * (creado una vez y leyendo el estado por refs): forma parte de las props de
 * MessageBubble y una identidad nueva repintaría todas las burbujas.
 */
export interface BubbleActions {
  retry: (messageId: string, anchor: DOMRect) => void
  edit: (messageId: string) => void
  rewind: (messageId: string) => void
}

/** Barra de acciones que aparece al pasar el ratón por la burbuja */
export function MessageActions(p: { message: ChatMessage; actions: BubbleActions }): React.JSX.Element | null {
  const m = p.message
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (m.streaming || m.role === 'system') return null
  const notice = isNoticeId(m.id)

  const copy = (): void => {
    void navigator.clipboard.writeText(m.text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="msg-actions" role="toolbar" aria-label="Acciones del mensaje">
      {m.text && (
        <button className="msg-act" onClick={copy} title="Copiar el texto">
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied && <span>Copiado</span>}
        </button>
      )}
      {m.role === 'assistant' && (
        <button
          className="msg-act"
          onClick={(e) => p.actions.retry(m.id, e.currentTarget.getBoundingClientRect())}
          title="Reintentar con otro modelo"
        >
          <IconRefresh size={12} />
          <span>Reintentar con…</span>
        </button>
      )}
      {m.role === 'user' && !notice && m.text && (
        <button className="msg-act" onClick={() => p.actions.edit(m.id)} title="Editar y reenviar">
          <IconPencil size={12} />
        </button>
      )}
      {m.role === 'user' && !isLocalId(m.id) && (
        <button
          className="msg-act"
          onClick={() => p.actions.rewind(m.id)}
          title="Rebobinar archivos hasta aquí"
        >
          <IconRewind size={12} />
        </button>
      )}
    </div>
  )
}
