import { memo, useContext } from 'react'
import hljs from 'highlight.js/lib/common'
import { MarkdownCwd } from './Markdown'

/**
 * Detalle legible de la acción en una tarjeta de permisos: en vez del JSON
 * plano del input, cada tool se pinta como en la TUI de Claude Code — comandos
 * como código resaltado, Edit como diff rojo/verde, Write con el contenido
 * coloreado según la extensión. El JSON queda como plegable de respaldo.
 */

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown',
  py: 'python', cs: 'csharp', java: 'java', sql: 'sql', css: 'css', scss: 'scss',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  yml: 'yaml', yaml: 'yaml', ps1: 'powershell', psm1: 'powershell',
  sh: 'bash', bash: 'bash', bat: 'dos', cmd: 'dos', rs: 'rust', go: 'go',
  php: 'php', rb: 'ruby', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  toml: 'ini', ini: 'ini', env: 'ini', dockerfile: 'dockerfile'
}

function langForPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const base = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'dockerfile'
  const ext = base.includes('.') ? base.split('.').at(-1)! : ''
  const lang = EXT_LANG[ext]
  return lang && hljs.getLanguage(lang) ? lang : undefined
}

function hlBlock(code: string, lang?: string): string {
  try {
    return lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : escapeHtml(code)
  } catch {
    return escapeHtml(code)
  }
}

/** Resalta línea por línea (los spans de hljs no pueden cruzar líneas del diff) */
function hlLines(text: string, lang?: string): string[] {
  return text.replace(/\n$/, '').split('\n').map((line) => hlBlock(line, lang))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function Code({ code, lang }: { code: string; lang?: string }): React.JSX.Element {
  return (
    <pre className="code-block perm-code">
      <code dangerouslySetInnerHTML={{ __html: hlBlock(code.replace(/\n$/, ''), lang) }} />
    </pre>
  )
}

function FileHeader({ path }: { path: string }): React.JSX.Element {
  const cwd = useContext(MarkdownCwd)
  return (
    <div
      className="perm-file"
      title="Abrir en VS Code / app del sistema"
      onClick={() => void window.deck.openTarget(path, cwd)}
    >
      📄 {path}
    </div>
  )
}

function Diff(p: { oldText: string; newText: string; lang?: string }): React.JSX.Element {
  return (
    <div className="perm-diff">
      {hlLines(p.oldText, p.lang).map((h, i) => (
        <div key={`d${i}`} className="diff-line del">
          <span className="diff-sign">−</span>
          <span dangerouslySetInnerHTML={{ __html: h }} />
        </div>
      ))}
      {hlLines(p.newText, p.lang).map((h, i) => (
        <div key={`i${i}`} className="diff-line ins">
          <span className="diff-sign">+</span>
          <span dangerouslySetInnerHTML={{ __html: h }} />
        </div>
      ))}
    </div>
  )
}

function Rows({ entries }: { entries: [string, unknown][] }): React.JSX.Element {
  return (
    <div className="perm-rows">
      {entries
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="perm-row">
            <span className="perm-key">{k}</span>
            <span className="perm-val">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
          </div>
        ))}
    </div>
  )
}

export const PermissionDetail = memo(function PermissionDetail(p: {
  toolName: string
  input?: Record<string, unknown>
  fallback: string
}): React.JSX.Element {
  const input = p.input
  if (!input) {
    return (
      <details>
        <summary>Ver detalle de la acción</summary>
        <pre>{p.fallback}</pre>
      </details>
    )
  }

  const str = (k: string): string | undefined =>
    typeof input[k] === 'string' ? (input[k] as string) : undefined
  const filePath = str('file_path') ?? str('path') ?? str('notebook_path')
  const lang = langForPath(filePath)

  let body: React.JSX.Element
  switch (p.toolName) {
    case 'Bash':
      body = (
        <>
          {str('description') && <div className="hint">{str('description')}</div>}
          <Code code={str('command') ?? ''} lang="bash" />
        </>
      )
      break
    case 'PowerShell':
      body = (
        <>
          {str('description') && <div className="hint">{str('description')}</div>}
          <Code code={str('command') ?? ''} lang="powershell" />
        </>
      )
      break
    case 'Edit':
      body = (
        <>
          {filePath && <FileHeader path={filePath} />}
          <Diff oldText={str('old_string') ?? ''} newText={str('new_string') ?? ''} lang={lang} />
          {input.replace_all === true && <div className="hint">Reemplaza todas las apariciones</div>}
        </>
      )
      break
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
      body = (
        <>
          {filePath && <FileHeader path={filePath} />}
          {edits.map((e, i) => (
            <Diff
              key={i}
              oldText={typeof e.old_string === 'string' ? e.old_string : ''}
              newText={typeof e.new_string === 'string' ? e.new_string : ''}
              lang={lang}
            />
          ))}
        </>
      )
      break
    }
    case 'Write':
      body = (
        <>
          {filePath && <FileHeader path={filePath} />}
          <Code code={str('content') ?? ''} lang={lang} />
        </>
      )
      break
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'WebFetch':
    case 'WebSearch':
      body = <Rows entries={Object.entries(input)} />
      break
    default:
      body = <Code code={JSON.stringify(input, null, 2)} lang="json" />
  }

  return (
    <div className="perm-detail">
      {body}
      <details className="perm-raw">
        <summary>Ver JSON crudo</summary>
        <pre>{p.fallback}</pre>
      </details>
    </div>
  )
})
