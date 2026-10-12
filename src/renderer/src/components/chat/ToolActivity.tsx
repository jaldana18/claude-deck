import { memo, useMemo, useState } from 'react'
import { hlBlock, hlLines, langForPath } from '../PermissionDetail'
import {
  IconAlertCircle,
  IconBot,
  IconCheck,
  IconChevronRight,
  IconFilePlus,
  IconLayers,
  IconPencil,
  IconPlug,
  IconTerminal
} from '../Icons'
import {
  computeHunk,
  diffStats,
  editPairs,
  filePathOf,
  groupLabel,
  groupToolUses,
  isAgentTool,
  isEditTool,
  isReadOnlyTool,
  isShellTool,
  prettyToolName,
  readLineFor,
  relPath,
  str,
  tailLines,
  toolInput,
  type RichToolUse
} from './logic'

type Status = 'run' | 'ok' | 'err'

const statusOf = (tu: RichToolUse): Status =>
  tu.isError ? 'err' : tu.result === undefined ? 'run' : 'ok'

const CONTEXT_LINES = 3

function StatusChip({ status }: { status: Status }): React.JSX.Element {
  if (status === 'run')
    return (
      <span className="cr-status cr-status--run">
        <span className="cd-dot cd-dot--busy" /> ejecutando
      </span>
    )
  if (status === 'err')
    return (
      <span className="cr-status cr-status--err">
        <IconAlertCircle size={12} /> error
      </span>
    )
  return (
    <span className="cr-status cr-status--ok" title="Completado">
      <IconCheck size={12} />
    </span>
  )
}

function StatChip({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <span className="cr-stat">
      <span className="cr-add">+{added}</span> <span className="cr-del">−{removed}</span>
    </span>
  )
}

function PathLink(p: { path: string; cwd: string; onOpenPath: (p: string) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="cr-path"
      title={`Abrir ${p.path}`}
      onClick={(e) => {
        e.stopPropagation()
        p.onOpenPath(p.path)
      }}
    >
      {relPath(p.path, p.cwd)}
    </button>
  )
}

function DiffView(p: { oldText: string; newText: string; lang?: string }): React.JSX.Element {
  const h = computeHunk(p.oldText, p.newText)
  const pre = h.pre.slice(-CONTEXT_LINES)
  const post = h.post.slice(0, CONTEXT_LINES)
  const hl = (lines: string[]): string[] => (lines.length ? hlLines(lines.join('\n') + '\n', p.lang) : [])
  const row = (cls: string, sign: string, html: string, key: string): React.JSX.Element => (
    <div key={key} className={`diff-line ${cls}`}>
      <span className="diff-sign">{sign}</span>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
  return (
    <div className="perm-diff cr-diff">
      {h.pre.length > pre.length && <div className="diff-line ctx cr-skip">⋯</div>}
      {hl(pre).map((x, i) => row('ctx', ' ', x, `p${i}`))}
      {hl(h.del).map((x, i) => row('del', '−', x, `d${i}`))}
      {hl(h.ins).map((x, i) => row('ins', '+', x, `i${i}`))}
      {hl(post).map((x, i) => row('ctx', ' ', x, `s${i}`))}
      {h.post.length > post.length && <div className="diff-line ctx cr-skip">⋯</div>}
    </div>
  )
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return <IconChevronRight size={12} className={`cr-chev${open ? ' open' : ''}`} />
}

/** Cabecera plegable: div con rol de botón para poder anidar enlaces dentro */
function Head(p: { open: boolean; onToggle: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="cr-head"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={p.onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          p.onToggle()
        }
      }}
    >
      <Chevron open={p.open} />
      {p.children}
    </div>
  )
}

// ---------------------------------------------------------------------------

const EditCard = memo(function EditCard(p: {
  tu: RichToolUse
  cwd: string
  onOpenPath: (p: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { tu } = p
  const { obj, truncated } = toolInput(tu)
  const fp = filePathOf(obj)
  const st = diffStats(tu)
  const status = statusOf(tu)
  const isNew = tu.name === 'Write'
  return (
    <div className={`cr-card cr-edit${status === 'err' ? ' is-error' : ''}`}>
      <Head open={open} onToggle={() => setOpen((o) => !o)}>
        {isNew ? <IconFilePlus size={13} className="cr-ico" /> : <IconPencil size={13} className="cr-ico" />}
        {fp ? (
          <PathLink path={fp} cwd={p.cwd} onOpenPath={p.onOpenPath} />
        ) : (
          <span className="cr-name">{tu.name}</span>
        )}
        {st && (st.added > 0 || st.removed > 0) && <StatChip {...st} />}
        {truncated && <span className="cr-trunc" title="La entrada llegó recortada">≈</span>}
        <span className="cr-spacer" />
        <StatusChip status={status} />
      </Head>
      {open && (
        <div className="cr-body">
          {editPairs(tu).map((e, i) => (
            <DiffView key={i} oldText={e.oldText} newText={e.newText} lang={langForPath(fp)} />
          ))}
          {obj.replace_all === true && <div className="cr-note">Reemplaza todas las apariciones</div>}
          {truncated && <div className="cr-note">Entrada recortada: el diff puede estar incompleto.</div>}
          {status === 'err' && tu.result && <pre className="cr-out cr-out--err">{tu.result}</pre>}
        </div>
      )}
    </div>
  )
})

const ShellCard = memo(function ShellCard(p: { tu: RichToolUse }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { tu } = p
  const { obj } = toolInput(tu)
  const cmd = str(obj, 'command') ?? ''
  const desc = str(obj, 'description')
  const status = statusOf(tu)
  const tail = open ? [] : tailLines(tu.result, 6)
  const firstLine = cmd.split('\n')[0]
  const multi = cmd.includes('\n') || cmd.length > 120
  return (
    <div className={`cr-card cr-shell${status === 'err' ? ' is-error' : ''}`}>
      <Head open={open} onToggle={() => setOpen((o) => !o)}>
        <IconTerminal size={13} className="cr-ico" />
        <code className="cr-cmd" title={cmd}>
          {firstLine}
          {cmd.includes('\n') ? ' …' : ''}
        </code>
        <StatusChip status={status} />
      </Head>
      {desc && <div className="cr-desc">{desc}</div>}
      {!open && tail.length > 0 && <pre className="cr-tail">{tail.join('\n')}</pre>}
      {open && (
        <div className="cr-body">
          {multi && (
            <pre className="code-block cr-code">
              <code
                dangerouslySetInnerHTML={{
                  __html: hlBlock(cmd, tu.name === 'PowerShell' ? 'powershell' : 'bash')
                }}
              />
            </pre>
          )}
          {tu.result !== undefined ? (
            <pre className={`cr-out${status === 'err' ? ' cr-out--err' : ''}`}>{tu.result || '(sin salida)'}</pre>
          ) : (
            <div className="cr-note">Aún sin salida…</div>
          )}
        </div>
      )}
    </div>
  )
})

const ReadLineView = memo(function ReadLineView(p: {
  tu: RichToolUse
  cwd: string
  onOpenPath: (p: string) => void
}): React.JSX.Element {
  const { tu } = p
  const l = readLineFor(tu, p.cwd)
  const status = statusOf(tu)
  const link = (text: string, target: string | undefined): React.JSX.Element =>
    target ? (
      <button type="button" className="cr-target cr-target--link" title={target} onClick={() => p.onOpenPath(target)}>
        {text}
      </button>
    ) : (
      <code className="cr-target" title={text}>
        {text}
      </code>
    )
  return (
    <div
      className={`cr-line${status === 'err' ? ' is-error' : ''}`}
      title={status === 'err' ? tu.result : undefined}
    >
      <span className={`cr-ldot cr-ldot--${status}`} />
      <span className="cr-verb">{l.verb}</span>
      {l.target && link(l.target, l.open)}
      {l.where && (
        <>
          <span className="cr-verb">en</span>
          {link(l.where, l.whereOpen)}
        </>
      )}
      {l.extra && <span className="cr-extra">{l.extra}</span>}
    </div>
  )
})

const ExploreGroup = memo(function ExploreGroup(p: {
  tools: RichToolUse[]
  files: number
  searches: number
  web: number
  cwd: string
  onOpenPath: (p: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const running = p.tools.some((t) => t.result === undefined && !t.isError)
  const errors = p.tools.filter((t) => t.isError).length
  return (
    <div className="cr-group">
      <Head open={open} onToggle={() => setOpen((o) => !o)}>
        <IconLayers size={12} className="cr-ico" />
        <span className="cr-verb">{groupLabel(p)}</span>
        {running && <span className="cd-dot cd-dot--busy" />}
        {errors > 0 && <span className="cr-del">{errors} con error</span>}
      </Head>
      {open && (
        <div className="cr-group-body">
          {p.tools.map((t) => (
            <ReadLineView key={t.id} tu={t} cwd={p.cwd} onOpenPath={p.onOpenPath} />
          ))}
        </div>
      )}
    </div>
  )
})

function prettyJson(text: string | undefined): string {
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const GenericCard = memo(function GenericCard(p: { tu: RichToolUse }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { tu } = p
  const status = statusOf(tu)
  return (
    <div className={`cr-card cr-generic${status === 'err' ? ' is-error' : ''}`}>
      <Head open={open} onToggle={() => setOpen((o) => !o)}>
        <IconPlug size={13} className="cr-ico" />
        <span className="cr-name" title={tu.name}>
          {prettyToolName(tu.name)}
        </span>
        <span className="cr-spacer" />
        <StatusChip status={status} />
      </Head>
      {open && (
        <div className="cr-body">
          <pre className="code-block cr-code">
            <code
              dangerouslySetInnerHTML={{
                __html: hlBlock(tu.inputObj ? JSON.stringify(tu.inputObj, null, 2) : prettyJson(tu.input), 'json')
              }}
            />
          </pre>
          {tu.result !== undefined && (
            <pre className={`cr-out${status === 'err' ? ' cr-out--err' : ''}`}>{prettyJson(tu.result)}</pre>
          )}
        </div>
      )}
    </div>
  )
})

function AgentLine({ tu }: { tu: RichToolUse }): React.JSX.Element {
  const { obj } = toolInput(tu)
  const status = statusOf(tu)
  return (
    <div className={`cr-line${status === 'err' ? ' is-error' : ''}`}>
      <span className={`cr-ldot cr-ldot--${status}`} />
      <IconBot size={12} className="cr-ico" />
      <span className="cr-verb">Subagente</span>
      <span className="cr-target">{str(obj, 'description') ?? str(obj, 'subagent_type') ?? ''}</span>
    </div>
  )
}

/** Actividad de herramientas de un mensaje del asistente, pintada según el tipo */
export const ToolActivity = memo(function ToolActivity(p: {
  toolUses: RichToolUse[]
  cwd: string
  onOpenPath: (path: string) => void
  renderAgent?: (tu: RichToolUse) => React.ReactNode
}): React.JSX.Element | null {
  const items = useMemo(() => groupToolUses(p.toolUses), [p.toolUses])
  if (items.length === 0) return null
  return (
    <div className="cr-tools">
      {items.map((it) => {
        if (it.kind === 'group')
          return (
            <ExploreGroup
              key={`g-${it.id}`}
              tools={it.tools}
              files={it.files}
              searches={it.searches}
              web={it.web}
              cwd={p.cwd}
              onOpenPath={p.onOpenPath}
            />
          )
        const tu = it.tu
        if (isEditTool(tu.name)) return <EditCard key={tu.id} tu={tu} cwd={p.cwd} onOpenPath={p.onOpenPath} />
        if (isShellTool(tu.name)) return <ShellCard key={tu.id} tu={tu} />
        if (isReadOnlyTool(tu.name))
          return <ReadLineView key={tu.id} tu={tu} cwd={p.cwd} onOpenPath={p.onOpenPath} />
        if (isAgentTool(tu.name))
          return p.renderAgent ? (
            <div key={tu.id} className="cr-agent">
              {p.renderAgent(tu)}
            </div>
          ) : (
            <AgentLine key={tu.id} tu={tu} />
          )
        return <GenericCard key={tu.id} tu={tu} />
      })}
    </div>
  )
})
