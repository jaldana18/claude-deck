import { createContext, memo, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

/** cwd de la pestaña activa: resuelve rutas relativas que devuelve el LLM */
export const MarkdownCwd = createContext('')

/** ¿Parece una ruta local abrible? (unidad Windows, con separadores, o archivo.ext) */
function looksLikePath(s: string): boolean {
  if (s.length > 260 || s.includes('\n')) return false
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true
  if (/^https?:\/\//i.test(s)) return true
  if (/[\\/]/.test(s) && /\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(s)) return true
  // archivo suelto con extensión (package.json, README.md…)
  return /^[\w.-]+\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(s)
}

function openTarget(target: string, cwd: string): void {
  void window.deck.openTarget(target, cwd)
}

/**
 * Render de las respuestas de Claude: el modelo ya emite markdown (mismo texto
 * que en la TUI, cero tokens extra) — aquí solo se pinta bonito. URLs y rutas
 * locales son clicables: navegador, VS Code o la app del sistema según el tipo.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  const cwd = useContext(MarkdownCwd)
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props
            const lang = /language-(\w+)/.exec(className ?? '')?.[1]
            const raw = String(children ?? '').replace(/\n$/, '')
            const isBlock = raw.includes('\n') || Boolean(lang)
            if (!isBlock) {
              if (looksLikePath(raw)) {
                return (
                  <code
                    className="inline-code path-link"
                    title="Abrir (VS Code / app del sistema / navegador)"
                    onClick={() => openTarget(raw, cwd)}
                  >
                    {raw}
                  </code>
                )
              }
              return <code className="inline-code">{raw}</code>
            }
            let html: string
            try {
              html = lang && hljs.getLanguage(lang)
                ? hljs.highlight(raw, { language: lang }).value
                : hljs.highlightAuto(raw).value
            } catch {
              html = escapeHtml(raw)
            }
            return (
              <pre className="code-block">
                <code dangerouslySetInnerHTML={{ __html: html }} />
              </pre>
            )
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  if (href) openTarget(href, cwd)
                }}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
