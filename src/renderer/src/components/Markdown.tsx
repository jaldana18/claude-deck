import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

/**
 * Render de las respuestas de Claude: el modelo ya emite markdown (mismo texto
 * que en la TUI, cero tokens extra) — aquí solo se pinta bonito.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
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
            if (!isBlock) return <code className="inline-code">{raw}</code>
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
              <a href={href} target="_blank" rel="noreferrer">
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
