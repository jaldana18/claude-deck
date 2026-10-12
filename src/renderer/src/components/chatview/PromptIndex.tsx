import { memo } from 'react'
import { IconX } from '../Icons'

export interface PromptEntry {
  id: string
  text: string
  time: string
}

/** Índice de los prompts del usuario en la conversación, a la derecha de la lista */
export const PromptIndex = memo(function PromptIndex(p: {
  prompts: PromptEntry[]
  activeId: string | null
  onJump: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <aside className="prompt-index" aria-label="Índice de prompts">
      <div className="prompt-index-head">
        <span>Tus prompts · {p.prompts.length}</span>
        <button className="iconbtn" onClick={p.onClose} title="Cerrar el índice">
          <IconX size={11} />
        </button>
      </div>
      <div className="prompt-index-list">
        {p.prompts.length === 0 && <p className="cd-help">Aún no has escrito nada en esta conversación.</p>}
        {p.prompts.map((e, i) => (
          <button
            key={e.id}
            className={`prompt-index-item ${p.activeId === e.id ? 'active' : ''}`}
            onClick={() => p.onJump(e.id)}
            title={e.text}
          >
            <span className="pi-num">{i + 1}</span>
            <span className="pi-text">{e.text}</span>
            {e.time && <span className="pi-time">{e.time}</span>}
          </button>
        ))}
      </div>
    </aside>
  )
})
