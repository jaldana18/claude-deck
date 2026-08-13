import { useEffect, useRef, useState } from 'react'
import type { ChatSearchResult } from '../../../shared/types'

interface Props {
  onClose: () => void
  onOpen: (cwd: string, sessionId: string) => Promise<void> | void
}

/** Ctrl+Shift+F: busca texto en todos los chats locales de Claude Code y los reabre */
export function SearchModal(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const mySeq = ++seq.current
    setSearching(true)
    const t = setTimeout(() => {
      void window.deck.searchChats(query).then((r) => {
        if (seq.current === mySeq) {
          setResults(r)
          setSearching(false)
        }
      })
    }, 450)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && p.onClose()}>
        <div className="modal-head">
          <h3>🔍 Buscar en todos los chats</h3>
          <button className="iconbtn" onClick={p.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ paddingBottom: 4 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Texto a buscar en las conversaciones guardadas…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <p className="hint">
              <span className="spinner" /> Buscando en ~/.claude/projects…
            </p>
          )}
        </div>
        <div className="search-list">
          {results.map((r) => (
            <div
              key={r.file}
              className="search-item"
              onClick={() => void p.onOpen(r.cwd, r.sessionId)}
              title={`Abrir pestaña con claude --resume ${r.sessionId}`}
            >
              <div className="meta">
                <span className="project">{r.cwd || r.projectDir}</span>
                <span>{new Date(r.mtimeMs).toLocaleString()}</span>
                <span>{r.matchCount} coincidencia(s)</span>
              </div>
              <span className="preview">…{r.preview}…</span>
            </div>
          ))}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="hint" style={{ padding: 12 }}>
              Sin coincidencias.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
