import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'

interface Props {
  /** id del PTY: el tabId para el panel principal, `tabId#n` para splits */
  paneId: string
  visible: boolean
  exited: boolean
  restartLabel: string
  onRestart: () => void
  onUserInput?: () => void
  onFocus?: () => void
}

/** Atajos globales que xterm NO debe consumir (los maneja App en fase captura) */
function isGlobalShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey) return false
  if (e.code === 'Tab') return true
  if (!e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) return true
  if (e.shiftKey && ['KeyP', 'KeyF', 'KeyT', 'KeyG', 'KeyH'].includes(e.code)) return true
  if (e.code === 'Backquote') return true
  return false
}

/**
 * Terminal xterm por panel. Se mantiene montado (oculto con visibility) para
 * no perder estado al cambiar de pestaña; el scrollback se serializa cada 5 s
 * y se restaura al montar (la pestaña "revive" tras reiniciar el PC).
 */
export function TerminalView(p: Props): React.JSX.Element {
  const holderRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const visibleRef = useRef(p.visible)
  visibleRef.current = p.visible

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      scrollback: 8000,
      allowProposedApi: true,
      // terminal siempre oscuro cálido (rediseño 2a), en ambos temas
      theme: {
        background: '#14120f',
        foreground: '#cfcabd',
        cursor: '#e0955f',
        selectionBackground: 'rgba(224,149,95,0.35)'
      }
    })
    const fit = new FitAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(serialize)
    term.attachCustomKeyEventHandler((e) => {
      if (isGlobalShortcut(e)) return false
      if (e.type !== 'keydown') return true
      // Convención Windows Terminal: Ctrl+C con selección COPIA (no manda ^C);
      // sin selección sigue siendo la interrupción de siempre.
      if (e.ctrlKey && !e.altKey && e.code === 'KeyC' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      // Ctrl+Shift+V pega (Ctrl+V ya funciona nativo)
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        void navigator.clipboard.readText().then((t) => t && term.paste(t))
        return false
      }
      return true
    })
    term.open(holder)

    // Clic derecho: copia la selección si la hay; si no, pega (como Windows Terminal)
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
      } else {
        void navigator.clipboard.readText().then((t) => t && term.paste(t))
      }
    }
    holder.addEventListener('contextmenu', onContextMenu)
    termRef.current = term
    fitRef.current = fit

    let dirty = false
    let disposed = false
    const paneId = p.paneId

    const dataDisp = term.onData((data) => {
      dirty = true
      window.deck.ptyInput(paneId, data)
      p.onUserInput?.()
    })

    let offPty: (() => void) | null = null

    void (async () => {
      // 1. Restaurar el scrollback guardado (contenido de la sesión anterior)
      const saved = await window.deck.loadScrollback(paneId)
      if (disposed) return
      if (saved) term.write(saved + '\r\n')
      // 2. Suscribirse al stream en vivo y pedir lo bufferizado durante el arranque
      offPty = window.deck.onPtyData(({ paneId: id, data }) => {
        if (id === paneId) {
          dirty = true
          term.write(data)
        }
      })
      const buffered = await window.deck.ptyAttach(paneId)
      if (buffered && !disposed) term.write(buffered)
      queueMicrotask(() => {
        if (!disposed && visibleRef.current) {
          fit.fit()
          window.deck.ptyResize(paneId, term.cols, term.rows)
        }
      })
    })()

    const persist = (): void => {
      if (!dirty) return
      dirty = false
      try {
        window.deck.saveScrollback(paneId, serialize.serialize())
      } catch {
        /* ignore */
      }
    }
    const saveTimer = setInterval(persist, 5000)

    const ro = new ResizeObserver(() => {
      if (!visibleRef.current) return
      try {
        fit.fit()
        window.deck.ptyResize(paneId, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    })
    ro.observe(holder)

    const onBeforeUnload = (): void => persist()
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      disposed = true
      persist()
      clearInterval(saveTimer)
      window.removeEventListener('beforeunload', onBeforeUnload)
      holder.removeEventListener('contextmenu', onContextMenu)
      ro.disconnect()
      offPty?.()
      dataDisp.dispose()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.paneId])

  // Al volverse visible: ajustar tamaño y enfocar
  useEffect(() => {
    if (p.visible && termRef.current && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
          const t = termRef.current
          if (t) {
            window.deck.ptyResize(p.paneId, t.cols, t.rows)
          }
        } catch {
          /* ignore */
        }
      })
    }
  }, [p.visible, p.paneId])

  return (
    <div
      className={`term-holder ${p.visible ? 'visible' : 'hidden'}`}
      onMouseDown={p.onFocus}
    >
      <div ref={holderRef} style={{ height: '100%' }} />
      {p.exited && p.visible && (
        <div className="exited-bar">
          <span>El proceso de este panel terminó.</span>
          <button className="iconbtn" onClick={p.onRestart}>
            ↻ {p.restartLabel}
          </button>
        </div>
      )}
    </div>
  )
}
