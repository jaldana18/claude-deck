import { Children, createContext, isValidElement, memo, useContext, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// subset «common» (~40 lenguajes): ahorra ~1 MB frente al paquete completo
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import { CopyButton } from './chat/CopyButton'

/** cwd de la pestaña activa: resuelve rutas relativas que devuelve el LLM */
export const MarkdownCwd = createContext('')

/** ¿Parece una ruta local abrible? (unidad Windows, con separadores, o archivo.ext) */
function looksLikePath(s: string): boolean {
  if (s.length > 260 || s.includes('\n')) return false
  if (/^https?:\/\//i.test(s)) return true
  // Sufijo de línea/columna al citar: archivo.ts:42, archivo.ts:42:8, archivo.ts#L42
  const base = s.replace(/(?::\d+(?::\d+)?|#L\d+)$/, '')
  if (/^[a-zA-Z]:[\\/]/.test(base)) return true
  if (/[\\/]/.test(base) && /\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(base)) return true
  // archivo suelto con extensión (package.json, README.md…)
  return /^[\w.-]+\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(base)
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
          // Los bloques cercados llegan como <pre><code>: se pintan desde aquí para
          // que un comando de una línea sin lenguaje también sea bloque copiable.
          pre({ children }) {
            const child = Children.toArray(children)[0]
            if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
              return <pre className="code-block">{children}</pre>
            }
            const lang = /language-(\w+)/.exec(child.props.className ?? '')?.[1]
            const raw = String(child.props.children ?? '').replace(/\n$/, '')
            return <CodeBlock raw={raw} lang={lang} />
          },
          code({ children }) {
            const raw = String(children ?? '')
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

function CodeBlock({ raw, lang }: { raw: string; lang?: string }): React.JSX.Element {
  let html: string
  try {
    html = lang && hljs.getLanguage(lang)
      ? hljs.highlight(raw, { language: lang }).value
      : raw.includes('\n')
        ? hljs.highlightAuto(raw).value
        : escapeHtml(raw)
  } catch {
    html = escapeHtml(raw)
  }
  return (
    <div className="code-wrap">
      <div className="code-head">
        <span className="code-lang">{lang ?? ''}</span>
        <CopyButton text={raw} title="Copiar el código" />
      </div>
      <pre className="code-block">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
