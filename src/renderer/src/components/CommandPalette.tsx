import { useEffect, useRef, useState } from 'react'
import type { Snippet, TabState } from '../../../shared/types'

interface Props {
  activeTab: TabState | null
  onClose: () => void
  onInsert: (text: string, submit: boolean) => void
}

/** Paleta Ctrl+Shift+P: snippets globales y del proyecto, insertables en el terminal activo */
export function CommandPalette(p: Props): React.JSX.Element {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', text: '', submit: false, projectOnly: false })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.deck.listSnippets().then(setSnippets)
    inputRef.current?.focus()
  }, [])

  const visible = snippets.filter((s) => {
    if (s.projectCwd && s.projectCwd !== p.activeTab?.cwd) return false
    const q = query.toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || s.text.toLowerCase().includes(q)
  })

  const run = (s: Snippet): void => p.onInsert(s.text, s.submit)

  const saveDraft = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.text.trim()) return
    const next = await window.deck.saveSnippet({
      id: `snip-${Date.now()}`,
      name: draft.name,
      text: draft.text,
      submit: draft.submit,
      projectCwd: draft.projectOnly ? p.activeTab?.cwd : undefined
    })
    setSnippets(next)
    setAdding(false)
    setDraft({ name: '', text: '', submit: false, projectOnly: false })
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') p.onClose()
    else if (e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, visible.length - 1))
    else if (e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter' && visible[sel]) run(visible[sel])
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" onKeyDown={onKey}>
        <div className="modal-head">
          <h3>⚡ Paleta de comandos</h3>
          <button className="iconbtn" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Volver' : '+ Snippet'}
          </button>
        </div>
        {adding ? (
          <div className="modal-body">
            <label>Nombre</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <label>Texto a insertar en el terminal</label>
            <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <label>
              <input
                type="checkbox"
                checked={draft.submit}
                onChange={(e) => setDraft({ ...draft, submit: e.target.checked })}
              />{' '}
              Enviar con Enter automáticamente
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.projectOnly}
                onChange={(e) => setDraft({ ...draft, projectOnly: e.target.checked })}
              />{' '}
              Solo para el proyecto actual
            </label>
            <div className="modal-foot" style={{ borderTop: 'none', paddingRight: 0 }}>
              <button className="iconbtn primary" onClick={() => void saveDraft()}>
                Guardar snippet
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-body" style={{ paddingBottom: 4 }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="Filtrar… (Enter inserta en la pestaña activa)"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSel(0)
                }}
              />
            </div>
            <div className="palette-list">
              {visible.map((s, i) => (
                <div
                  key={s.id}
                  className={`palette-item ${i === sel ? 'sel' : ''}`}
                  onClick={() => run(s)}
                  onMouseEnter={() => setSel(i)}
                >
                  <span>
                    {s.name}
                    {s.projectCwd ? ' · 📁 proyecto' : ''}
                    {s.submit ? ' · ⏎' : ''}
                  </span>
                  <span className="snippet-text">{s.text}</span>
                </div>
              ))}
              {visible.length === 0 && <p className="hint" style={{ padding: 12 }}>Sin resultados.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
