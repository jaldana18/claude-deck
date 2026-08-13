import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AzureListItem,
  BoardData,
  GitInfo,
  TabState,
  TodoItem,
  WidgetKind,
  WidgetSide,
  WidgetState
} from '../../../shared/types'
import { IconBoard, IconGitBranch, IconRefresh, IconTasks, IconX } from './Icons'

export interface AgentRun {
  id: string
  label: string
  running: boolean
  msgCount: number
}

interface DockProps {
  side: WidgetSide
  widgets: WidgetState[]
  tab: TabState
  agents: AgentRun[]
  todos: TodoItem[]
  onOpenSubagent: (id: string) => void
  onChange: (widgets: WidgetState[]) => void
}

const WIDGET_TITLES: Record<WidgetKind, string> = {
  git: 'Git',
  board: 'Sprint',
  agents: 'Actividad'
}

const LANE_COLORS = ['#d97757', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba', '#39c5cf']
const DONE_STATES = new Set(['Done', 'Closed', 'Resolved', 'Removed'])

/**
 * Dock lateral de widgets: se arrastran entre los dos laterales del chat
 * (por la cabecera), se reordenan soltando sobre otro widget, y su altura se
 * ajusta con el asa inferior. El layout persiste en deck-state.json.
 */
export function WidgetDock(p: DockProps): React.JSX.Element | null {
  const [dragOver, setDragOver] = useState(false)
  const mine = p.widgets.filter((w) => w.side === p.side).sort((a, b) => a.order - b.order)

  // Siempre operar sobre la lista VIVA: los listeners de mouse/drag pueden
  // dispararse desde closures viejos y no deben pisar cambios posteriores
  // (p.ej. cambiar la carpeta del git y luego redimensionar).
  const widgetsRef = useRef(p.widgets)
  widgetsRef.current = p.widgets

  const moveWidget = (id: string, side: WidgetSide, beforeId?: string): void => {
    const next = widgetsRef.current.map((w) => ({ ...w }))
    const widget = next.find((w) => w.id === id)
    if (!widget) return
    widget.side = side
    const siblings = next.filter((w) => w.side === side && w.id !== id).sort((a, b) => a.order - b.order)
    const insertAt = beforeId ? siblings.findIndex((w) => w.id === beforeId) : siblings.length
    siblings.splice(insertAt < 0 ? siblings.length : insertAt, 0, widget)
    siblings.forEach((w, i) => (w.order = i))
    p.onChange(next)
  }

  if (mine.length === 0 && !dragOver) {
    // zona de drop finita aunque el dock esté vacío (para poder arrastrar hacia él)
    return (
      <div
        className="widget-dock empty"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const id = e.dataTransfer.getData('deck/widget')
          if (id) moveWidget(id, p.side)
        }}
      />
    )
  }

  return (
    <div
      className={`widget-dock ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const id = e.dataTransfer.getData('deck/widget')
        if (id) moveWidget(id, p.side)
      }}
    >
      {mine.map((w) => (
        <Widget
          key={w.id}
          widget={w}
          tab={p.tab}
          agents={p.agents}
          todos={p.todos}
          onOpenSubagent={p.onOpenSubagent}
          onDropBefore={(draggedId) => moveWidget(draggedId, p.side, w.id)}
          onResize={(h) => {
            p.onChange(widgetsRef.current.map((x) => (x.id === w.id ? { ...x, height: h } : x)))
          }}
          onConfig={(config) => {
            p.onChange(widgetsRef.current.map((x) => (x.id === w.id ? { ...x, config } : x)))
          }}
          onClose={() => p.onChange(widgetsRef.current.filter((x) => x.id !== w.id))}
        />
      ))}
    </div>
  )
}

interface WidgetProps {
  widget: WidgetState
  tab: TabState
  agents: AgentRun[]
  todos: TodoItem[]
  onOpenSubagent: (id: string) => void
  onDropBefore: (draggedId: string) => void
  onResize: (height: number) => void
  onConfig: (config: WidgetState['config']) => void
  onClose: () => void
}

function Widget(p: WidgetProps): React.JSX.Element {
  const resizing = useRef(false)
  const [liveHeight, setLiveHeight] = useState(p.widget.height)
  // props vivas para los listeners globales (evita stale closures al soltar)
  const propsRef = useRef(p)
  propsRef.current = p

  useEffect(() => setLiveHeight(p.widget.height), [p.widget.height])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!resizing.current) return
      setLiveHeight((h) => Math.min(window.innerHeight * 0.7, Math.max(140, h + e.movementY)))
    }
    const onUp = (): void => {
      if (resizing.current) {
        resizing.current = false
        document.body.style.cursor = ''
        setLiveHeight((h) => {
          propsRef.current.onResize(h)
          return h
        })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const icon =
    p.widget.kind === 'git' ? (
      <IconGitBranch size={12} />
    ) : p.widget.kind === 'board' ? (
      <IconBoard size={12} />
    ) : (
      <IconTasks size={12} />
    )

  // sufijo que distingue instancias duplicadas (dos gits, dos boards…)
  const suffix =
    p.widget.kind === 'git'
      ? (p.widget.config.repoPath || p.tab.cwd).split(/[\\/]/).filter(Boolean).at(-1)
      : p.widget.kind === 'board'
        ? (p.widget.config.iterationName ?? p.widget.config.project)
        : undefined

  return (
    <div
      className="widget"
      style={{ height: liveHeight }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const id = e.dataTransfer.getData('deck/widget')
        if (id && id !== p.widget.id) p.onDropBefore(id)
      }}
    >
      <div
        className="widget-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('deck/widget', p.widget.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        title="Arrastra para mover el widget al otro lateral o reordenarlo"
      >
        <span className="widget-title iconlabel">
          {icon} {WIDGET_TITLES[p.widget.kind]}
          {suffix && <span className="widget-suffix">· {suffix}</span>}
        </span>
        <button className="widget-btn" onClick={p.onClose} title="Quitar widget">
          <IconX size={11} />
        </button>
      </div>
      <div className="widget-body">
        {p.widget.kind === 'git' && <GitWidget widget={p.widget} tab={p.tab} onConfig={p.onConfig} />}
        {p.widget.kind === 'board' && <BoardWidget widget={p.widget} tab={p.tab} onConfig={p.onConfig} />}
        {p.widget.kind === 'agents' && (
          <AgentsWidget agents={p.agents} todos={p.todos} onOpenSubagent={p.onOpenSubagent} />
        )}
      </div>
      <div
        className="widget-resize"
        onMouseDown={(e) => {
          e.preventDefault()
          resizing.current = true
          document.body.style.cursor = 'ns-resize'
        }}
        title="Arrastra para cambiar la altura"
      />
    </div>
  )
}

// ---------- Widget: Git ----------

function GitWidget(p: {
  widget: WidgetState
  tab: TabState
  onConfig: (c: WidgetState['config']) => void
}): React.JSX.Element {
  const repoPath = p.widget.config.repoPath || p.tab.cwd
  const [info, setInfo] = useState<GitInfo | null>(null)

  const refresh = useCallback(async () => {
    setInfo(await window.deck.gitInfo(repoPath))
  }, [repoPath])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 20_000)
    return () => clearInterval(t)
  }, [refresh])

  const pickRepo = async (): Promise<void> => {
    const folder = await window.deck.pickFolder()
    if (folder) p.onConfig({ ...p.widget.config, repoPath: folder })
  }

  return (
    <div className="gitw">
      <div className="widget-toolbar">
        <span className="widget-path" title={repoPath} onClick={() => void pickRepo()}>
          📁 {repoPath.split(/[\\/]/).filter(Boolean).at(-1)}
        </span>
        {info?.isRepo && (
          <>
            <span className="chip project"> {info.branch}</span>
            {info.dirtyCount > 0 && <span className="chip">± {info.dirtyCount}</span>}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button className="widget-btn" onClick={() => void refresh()} title="Refrescar">
          <IconRefresh size={11} />
        </button>
      </div>
      {info && !info.isRepo && (
        <p className="hint" style={{ padding: 8 }}>
          Esta carpeta no es un repo git. Clic en la ruta para elegir dónde está el repo (puede
          ser una carpeta distinta a la del chat).
        </p>
      )}
      {info?.isRepo && (
        <div className="gitw-log">
          {info.commits.map((c, i) => (
            <GitRow key={c.hash} commit={c} prev={info.commits[i - 1]} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Fila del grafo estilo tradicional (gitk/GitKraken): los carriles que vienen
 * de la fila anterior se dibujan como líneas continuas; el commit pone su
 * punto en su carril; los merges y confluencias se curvan hacia/desde él.
 */
function GitRow(p: { commit: import('../../../shared/types').GitCommit; prev?: import('../../../shared/types').GitCommit }): React.JSX.Element {
  const c = p.commit
  const H = 26
  const X = (l: number): number => l * 11 + 6
  const color = (l: number): string => LANE_COLORS[l % LANE_COLORS.length]
  // carriles que entran a esta fila = los activos tras la fila anterior
  // (la primera fila no tiene líneas entrantes)
  const incoming = p.prev ? p.prev.activeAfter : []
  const outgoing = c.activeAfter
  const maxLane = Math.max(c.lane, ...incoming, ...outgoing, ...c.mergeLanes, ...c.closes, 0)
  const w = Math.min((maxLane + 1) * 11 + 4, 90)

  return (
    <div className="gitw-row" title={`${c.hash.slice(0, 10)} — ${c.author} · ${c.date}`}>
      <svg width={w} height={H} className="git-graph">
        {/* carriles que pasan de largo (entran y salen sin tocar el commit) */}
        {incoming
          .filter((l) => l !== c.lane && !c.closes.includes(l) && outgoing.includes(l))
          .map((l) => (
            <line key={`t${l}`} x1={X(l)} y1={0} x2={X(l)} y2={H} stroke={color(l)} strokeWidth="1.6" opacity="0.55" />
          ))}
        {/* mitad superior del carril del commit (si venía de arriba) */}
        {incoming.includes(c.lane) && (
          <line x1={X(c.lane)} y1={0} x2={X(c.lane)} y2={H / 2} stroke={color(c.lane)} strokeWidth="1.6" opacity="0.8" />
        )}
        {/* mitad inferior (si su primer padre continúa hacia abajo) */}
        {outgoing.includes(c.lane) && (
          <line x1={X(c.lane)} y1={H / 2} x2={X(c.lane)} y2={H} stroke={color(c.lane)} strokeWidth="1.6" opacity="0.8" />
        )}
        {/* ramas que confluyen en este commit: curva desde arriba hacia el punto */}
        {c.closes.map((l) => (
          <path
            key={`c${l}`}
            d={`M ${X(l)} 0 C ${X(l)} ${H / 2}, ${X(c.lane)} ${H / 2}, ${X(c.lane)} ${H / 2}`}
            stroke={color(l)}
            strokeWidth="1.6"
            fill="none"
            opacity="0.7"
          />
        ))}
        {/* merges: curva desde el punto hacia el carril del padre extra */}
        {c.mergeLanes.map((l) => (
          <path
            key={`m${l}`}
            d={`M ${X(c.lane)} ${H / 2} C ${X(l)} ${H / 2}, ${X(l)} ${H / 2}, ${X(l)} ${H}`}
            stroke={color(l)}
            strokeWidth="1.6"
            fill="none"
            opacity="0.7"
          />
        ))}
        <circle
          cx={X(c.lane)}
          cy={H / 2}
          r={c.parents.length > 1 ? 4 : 3.2}
          fill={color(c.lane)}
          stroke="var(--bg)"
          strokeWidth="1.5"
        />
      </svg>
      <div className="gitw-commit">
        <div className="git-subject">
          {c.refs.slice(0, 2).map((r) => (
            <span key={r} className="git-ref">
              {r}
            </span>
          ))}
          {c.subject}
        </div>
      </div>
    </div>
  )
}

// ---------- Widget: Board del sprint ----------

function BoardWidget(p: {
  widget: WidgetState
  tab: TabState
  onConfig: (c: WidgetState['config']) => void
}): React.JSX.Element {
  const cfg = p.widget.config
  const [configuring, setConfiguring] = useState(!cfg.project)
  const [projects, setProjects] = useState<AzureListItem[]>([])
  const [teams, setTeams] = useState<AzureListItem[]>([])
  const [iterations, setIterations] = useState<{ id: string; name: string; timeFrame?: string }[]>([])
  const [selProject, setSelProject] = useState(cfg.project ?? '')
  const [selTeam, setSelTeam] = useState(cfg.team ?? '')
  const [selIteration, setSelIteration] = useState(cfg.iterationId ?? '')
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')

  // cargar listados al entrar en modo configuración
  useEffect(() => {
    if (!configuring) return
    setListError('')
    window.deck
      .boardProjects(p.tab.cwd)
      .then(setProjects)
      .catch((e) => setListError(String(e)))
  }, [configuring, p.tab.cwd])

  useEffect(() => {
    if (!configuring || !selProject) return
    setTeams([])
    window.deck
      .boardTeams(p.tab.cwd, selProject)
      .then(setTeams)
      .catch((e) => setListError(String(e)))
  }, [configuring, selProject, p.tab.cwd])

  useEffect(() => {
    if (!configuring || !selProject || !selTeam) return
    setIterations([])
    window.deck
      .boardIterations(p.tab.cwd, selProject, selTeam)
      .then(setIterations)
      .catch((e) => setListError(String(e)))
  }, [configuring, selProject, selTeam, p.tab.cwd])

  const load = useCallback(async () => {
    if (!cfg.project || !cfg.team) return
    setLoading(true)
    setData(await window.deck.boardGet(p.tab.cwd, cfg.project, cfg.team, cfg.iterationId))
    setLoading(false)
  }, [cfg.project, cfg.team, cfg.iterationId, p.tab.cwd])

  useEffect(() => {
    if (configuring) return
    void load()
    const t = setInterval(() => void load(), 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [configuring, load])

  // Filtro por responsable: se llena con los responsables reales del sprint
  const assignees = [...new Set((data?.items ?? []).map((i) => i.assignedTo))].sort()
  const filteredItems = (data?.items ?? []).filter(
    (i) => !cfg.assignee || i.assignedTo === cfg.assignee
  )
  const total = filteredItems.length
  const done = filteredItems.filter((i) => DONE_STATES.has(i.state)).length

  if (configuring) {
    return (
      <div className="boardw-config">
        {listError && <div className="validation err">{listError}</div>}
        <label>Proyecto</label>
        <select value={selProject} onChange={(e) => { setSelProject(e.target.value); setSelTeam(''); setSelIteration('') }}>
          <option value="">— elegir —</option>
          {projects.map((pr) => (
            <option key={pr.name} value={pr.name}>
              {pr.name}
            </option>
          ))}
        </select>
        <label>Equipo</label>
        <select value={selTeam} disabled={!selProject} onChange={(e) => { setSelTeam(e.target.value); setSelIteration('') }}>
          <option value="">— elegir —</option>
          {teams.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <label>Sprint</label>
        <select value={selIteration} disabled={!selTeam} onChange={(e) => setSelIteration(e.target.value)}>
          <option value="">Actual (automático)</option>
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
              {it.timeFrame === 'current' ? ' · actual' : ''}
            </option>
          ))}
        </select>
        <button
          className="iconbtn primary"
          disabled={!selProject || !selTeam}
          onClick={() => {
            const iterName = iterations.find((i) => i.id === selIteration)?.name
            p.onConfig({
              ...cfg,
              project: selProject,
              team: selTeam,
              iterationId: selIteration || undefined,
              iterationName: iterName
            })
            setConfiguring(false)
          }}
        >
          Ver board
        </button>
      </div>
    )
  }

  return (
    <div className="boardw">
      <div className="widget-toolbar">
        <span className="widget-path" title={`${cfg.project} · ${cfg.team}`} onClick={() => setConfiguring(true)}>
          {data?.sprintName ?? cfg.iterationName ?? 'Sprint actual'}
        </span>
        {total > 0 && (
          <span className="chip project">
            {done}/{total}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="widget-btn" onClick={() => void load()} title="Refrescar">
          <IconRefresh size={11} />
        </button>
      </div>
      {assignees.length > 0 && (
        <div className="boardw-filter">
          <select
            value={cfg.assignee ?? ''}
            onChange={(e) => p.onConfig({ ...cfg, assignee: e.target.value || undefined })}
            title="Mostrar solo las tareas de un responsable"
          >
            <option value="">👥 Todos los responsables</option>
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}
      {total > 0 && (
        <div className="boardw-progress">
          <div className="boardw-bar" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}
      {loading && !data && (
        <p className="hint" style={{ padding: 8 }}>
          <span className="spinner" /> Consultando vía MCP…
        </p>
      )}
      {data && !data.ok && <div className="validation err" style={{ margin: 8 }}>{data.error}</div>}
      {data?.ok && (
        <div className="boardw-list">
          {groupByState(filteredItems).map(({ state, items }) => (
            <div key={state}>
              <div className="side-section-title">
                {state} ({items.length})
              </div>
              {items.map((item) => (
                <div key={item.id} className="boardw-item" title={`#${item.id} · ${item.assignedTo}`}>
                  <span className="board-id">#{item.id}</span> {item.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function groupByState(items: BoardData['items']): { state: string; items: BoardData['items'] }[] {
  const order = ['New', 'Proposed', 'Approved', 'Committed', 'To Do', 'Active', 'In Progress', 'Doing', 'Resolved', 'In Review', 'Done', 'Closed']
  const map = new Map<string, BoardData['items']>()
  for (const i of items) map.set(i.state, [...(map.get(i.state) ?? []), i])
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map(([state, items]) => ({ state, items }))
}

// ---------- Widget: Actividad (agentes + plan) ----------

function AgentsWidget(p: {
  agents: AgentRun[]
  todos: TodoItem[]
  onOpenSubagent: (id: string) => void
}): React.JSX.Element {
  const running = p.agents.filter((a) => a.running)
  return (
    <div className="agentsw">
      {running.length === 0 && p.todos.length === 0 && (
        <p className="hint" style={{ padding: 8 }}>
          Aquí verás los agentes en ejecución y el plan de tareas de Claude cuando los haya.
        </p>
      )}
      {running.length > 0 && (
        <>
          <div className="side-section-title">🤖 Agentes en ejecución</div>
          {running.map((a) => (
            <div key={a.id} className="agent-item running" onClick={() => p.onOpenSubagent(a.id)}>
              <span className="dot working" />
              <span className="agent-label">{a.label}</span>
              <span className="agent-meta">{a.msgCount > 0 ? `${a.msgCount}` : '…'}</span>
            </div>
          ))}
        </>
      )}
      {p.todos.length > 0 && (
        <>
          <div className="side-section-title">📋 Plan</div>
          {p.todos.map((t, i) => (
            <div key={i} className={`task-item ${t.status}`}>
              <span className="task-icon">
                {t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⚪'}
              </span>
              <span className="task-text">
                {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
