import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type {
  AzureListItem,
  BoardData,
  ChatHealth,
  CiBuild,
  CiPullRequest,
  CiRepoInfo,
  GitInfo,
  TabState,
  TodoItem,
  WidgetKind,
  WidgetSide,
  WidgetState
} from '../../../shared/types'
import { Markdown } from './Markdown'
import {
  IconBoard,
  IconBook,
  IconGitBranch,
  IconPlay,
  IconPr,
  IconPulse,
  IconRefresh,
  IconTasks,
  IconX
} from './Icons'

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
  /** pestaña visible: los widgets ocultos no consultan git/MCP/red */
  visible: boolean
  agents: AgentRun[]
  todos: TodoItem[]
  onOpenSubagent: (id: string) => void
  onChange: (widgets: WidgetState[]) => void
}

const WIDGET_TITLES: Record<WidgetKind, string> = {
  git: 'Git',
  board: 'Sprint',
  agents: 'Actividad',
  health: 'Salud',
  tasks: 'Tareas',
  ci: 'Pipelines',
  prs: 'Pull requests',
  notes: 'Notas'
}

const LANE_COLORS = ['#d97757', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba', '#39c5cf']
const DONE_STATES = new Set(['Done', 'Closed', 'Resolved', 'Removed'])

/**
 * Dock lateral de widgets: se arrastran entre los dos laterales del chat
 * (por la cabecera), se reordenan soltando sobre otro widget, y su altura se
 * ajusta con el asa inferior. El layout persiste en deck-state.json.
 */
export const WidgetDock = memo(function WidgetDock(p: DockProps): React.JSX.Element | null {
  const mine = p.widgets.filter((w) => w.side === p.side).sort((a, b) => a.order - b.order)

  // Ancho del dock ajustable por el usuario (persiste por lado en localStorage)
  const [dockWidth, setDockWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(`deck-dock-w-${p.side}`))
    return saved >= 240 ? saved : null
  })
  const [resizingDock, setResizingDock] = useState(false)
  const onDockResizeStart = (e: React.PointerEvent): void => {
    e.preventDefault()
    setResizingDock(true)
    const startX = e.clientX
    const startW = dockWidth ?? (e.currentTarget.parentElement as HTMLElement).offsetWidth
    const dir = p.side === 'left' ? 1 : -1
    const onMove = (ev: PointerEvent): void => {
      const w = Math.min(560, Math.max(240, startW + dir * (ev.clientX - startX)))
      setDockWidth(w)
    }
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizingDock(false)
      const w = Math.min(560, Math.max(240, startW + dir * (ev.clientX - startX)))
      localStorage.setItem(`deck-dock-w-${p.side}`, String(w))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Siempre operar sobre la lista VIVA: los listeners de mouse/drag pueden
  // dispararse desde closures viejos y no deben pisar cambios posteriores
  // (p.ej. cambiar la carpeta del git y luego redimensionar).
  const widgetsRef = useRef(p.widgets)
  widgetsRef.current = p.widgets

  // Callbacks ESTABLES: si se recrean en cada render, la memo de Widget no
  // sirve de nada y todos los widgets se repintan con cada delta del chat.
  const onChangeRef = useRef(p.onChange)
  onChangeRef.current = p.onChange

  const patchWidget = useCallback((id: string, patch: Partial<WidgetState>): void => {
    onChangeRef.current(widgetsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }, [])

  const removeWidget = useCallback((id: string): void => {
    onChangeRef.current(widgetsRef.current.filter((x) => x.id !== id))
  }, [])

  const moveWidget = useCallback((id: string, side: WidgetSide, beforeId?: string): void => {
    const next = widgetsRef.current.map((w) => ({ ...w }))
    const widget = next.find((w) => w.id === id)
    if (!widget) return
    widget.side = side
    const siblings = next.filter((w) => w.side === side && w.id !== id).sort((a, b) => a.order - b.order)
    const insertAt = beforeId ? siblings.findIndex((w) => w.id === beforeId) : siblings.length
    siblings.splice(insertAt < 0 ? siblings.length : insertAt, 0, widget)
    siblings.forEach((w, i) => (w.order = i))
    onChangeRef.current(next)
    // aterrizaje 180ms scale(1.02→1) sobre el widget movido (kit §3)
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-widget-id="${id}"]`)
      if (el) {
        el.classList.add('cd-land')
        setTimeout(() => el.classList.remove('cd-land'), 220)
      }
    })
  }, [])

  return (
    <div
      className={`widget-dock ${mine.length === 0 ? 'empty' : ''}`}
      data-dock-side={p.side}
      /* El dock se adapta al widget más ancho (o al ancho fijado con su asa).
         Con widgets en media columna se asegura un mínimo: a 280px dos
         widgets emparejados quedarían de 130px y sin leerse. */
      style={
        mine.length > 0
          ? {
              width:
                Math.max(
                  dockWidth ?? 0,
                  ...mine.map((w) => w.width ?? 0),
                  mine.some((w) => w.half) ? 400 : 0
                ) || undefined
            }
          : undefined
      }
    >
      {/* asa en el borde interior: arrastra para ensanchar la columna */}
      {mine.length > 0 && (
        <div
          className={`dock-resize ${resizingDock ? 'active' : ''}`}
          style={p.side === 'left' ? { right: 0 } : { left: 0 }}
          onPointerDown={onDockResizeStart}
          title="Arrastra para cambiar el ancho de la columna de widgets"
        />
      )}
      {mine.map((w) => (
        <Widget
          key={w.id}
          widget={w}
          tab={p.tab}
          agents={p.agents}
          todos={p.todos}
          onOpenSubagent={p.onOpenSubagent}
          visible={p.visible}
          onMove={moveWidget}
          onPatch={patchWidget}
          onRemove={removeWidget}
        />
      ))}
      {/* punteado SOLO visible durante un arrastre (body.cd-drag-active, kit §3) */}
      <div className="cd-dropzone" data-dock-side={p.side}>
        soltar aquí
      </div>
    </div>
  )
})

interface WidgetProps {
  widget: WidgetState
  tab: TabState
  visible: boolean
  agents: AgentRun[]
  todos: TodoItem[]
  onOpenSubagent: (id: string) => void
  onMove: (id: string, side: WidgetSide, beforeId?: string) => void
  /** callbacks estables (id + parche) para no romper la memo de Widget */
  onPatch: (id: string, patch: Partial<WidgetState>) => void
  onRemove: (id: string) => void
}

const Widget = memo(function Widget(p: WidgetProps): React.JSX.Element {
  const resizing = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // height 0 = automática (contenido); >0 = fijada por el usuario con el asa
  const [liveHeight, setLiveHeight] = useState(p.widget.height)
  // props vivas para los listeners globales (evita stale closures al soltar)
  const propsRef = useRef(p)
  propsRef.current = p

  useEffect(() => setLiveHeight(p.widget.height), [p.widget.height])

  /** Listeners globales SOLO mientras se arrastra el asa (antes vivían
   *  permanentemente: 3 widgets × N pestañas escuchando cada mousemove). */
  const startHeightDrag = useCallback((): void => {
    resizing.current = true
    document.body.style.cursor = 'ns-resize'
    const onMove = (e: MouseEvent): void => {
      setLiveHeight((h) => Math.min(window.innerHeight * 0.7, Math.max(140, h + e.movementY)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      resizing.current = false
      document.body.style.cursor = ''
      setLiveHeight((h) => {
        propsRef.current.onPatch(propsRef.current.widget.id, { height: h })
        return h
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  /**
   * Arrastre por puntero (kit §3): se activa a los 4px de movimiento; el
   * original queda a .35, un ghost fijo sigue el cursor rotado 2.5°, las
   * dropzones aparecen con body.cd-drag-active, el widget bajo el cursor
   * hace jiggle, Esc o soltar fuera cancela (el ghost vuelve a su origen).
   */
  const onHeadPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.widget-btn')) return
    const startX = e.clientX
    const startY = e.clientY
    const root = rootRef.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    let ghost: HTMLDivElement | null = null
    let jiggling: Element | null = null
    let started = false

    const clearJiggle = (): void => {
      jiggling?.classList.remove('cd-jiggle')
      jiggling = null
    }

    const start = (): void => {
      started = true
      document.body.classList.add('cd-drag-active')
      root.classList.add('cd-widget--dragging')
      ghost = document.createElement('div')
      ghost.className = 'deck-widget-ghost'
      ghost.style.width = `${origin.width}px`
      ghost.textContent = `⠿ ${WIDGET_TITLES[propsRef.current.widget.kind]}`
      document.body.appendChild(ghost)
    }

    const place = (x: number, y: number): void => {
      if (!ghost) return
      ghost.style.left = `${x - 30}px`
      ghost.style.top = `${y - 14}px`
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('cd-drag-active')
      root.classList.remove('cd-widget--dragging')
      clearJiggle()
    }

    const cancel = (): void => {
      cleanup()
      if (ghost) {
        // el ghost vuelve a su origen 150ms y desaparece
        const g = ghost
        g.classList.add('returning')
        g.style.left = `${origin.left}px`
        g.style.top = `${origin.top}px`
        g.style.opacity = '0'
        setTimeout(() => g.remove(), 170)
      }
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        cancel()
      }
    }

    const onMove = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        start()
      }
      place(ev.clientX, ev.clientY)
      // jiggle del widget bajo el cursor (objetivo de reorden)
      const under = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((el) => el !== root && el.hasAttribute?.('data-widget-id'))
      if (under !== jiggling) {
        clearJiggle()
        if (under) {
          jiggling = under
          under.classList.add('cd-jiggle')
        }
      }
    }

    const onUp = (ev: PointerEvent): void => {
      if (!started) {
        cleanup()
        return
      }
      const stack = document.elementsFromPoint(ev.clientX, ev.clientY)
      const targetWidget = stack.find(
        (el) => el !== root && el.hasAttribute?.('data-widget-id')
      ) as HTMLElement | undefined
      const targetDock = stack.find((el) => el.hasAttribute?.('data-dock-side')) as
        | HTMLElement
        | undefined
      cleanup()
      ghost?.remove()
      const id = propsRef.current.widget.id
      if (targetWidget) {
        const side = (targetWidget.closest('[data-dock-side]') as HTMLElement | null)?.dataset
          .dockSide as WidgetSide | undefined
        propsRef.current.onMove(id, side ?? propsRef.current.widget.side, targetWidget.dataset.widgetId)
      } else if (targetDock) {
        propsRef.current.onMove(id, targetDock.dataset.dockSide as WidgetSide)
      }
      // soltar fuera de toda zona: no-op (equivale a cancelar)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  const patchConfig = useCallback((config: WidgetState['config']) => {
    propsRef.current.onPatch(propsRef.current.widget.id, { config })
  }, [])

  const icon =
    p.widget.kind === 'git' ? (
      <IconGitBranch size={12} />
    ) : p.widget.kind === 'board' ? (
      <IconBoard size={12} />
    ) : p.widget.kind === 'health' ? (
      <IconPulse size={12} />
    ) : p.widget.kind === 'ci' ? (
      <IconPlay size={12} />
    ) : p.widget.kind === 'prs' ? (
      <IconPr size={12} />
    ) : p.widget.kind === 'notes' ? (
      <IconBook size={12} />
    ) : (
      <IconTasks size={12} />
    )

  // sufijo que distingue instancias duplicadas (dos gits, dos boards…)
  const suffix =
    p.widget.kind === 'git'
      ? (p.widget.config.repoPath || p.tab.cwd).split(/[\\/]/).filter(Boolean).at(-1)
      : p.widget.kind === 'board'
        ? (p.widget.config.iterationName ?? p.widget.config.project)
        : p.widget.kind === 'tasks' && p.todos.length > 0
          ? `${p.todos.filter((t) => t.status === 'completed').length}/${p.todos.length}`
          : undefined

  return (
    <div
      ref={rootRef}
      className={`widget ${liveHeight > 0 ? '' : 'auto'} ${p.widget.half ? 'half' : ''}`}
      style={{
        ...(liveHeight > 0 ? { height: liveHeight } : {}),
        ...(p.widget.width && !p.widget.half ? { width: p.widget.width } : {})
      }}
      data-widget-id={p.widget.id}
    >
      <div
        className="widget-head"
        onPointerDown={onHeadPointerDown}
        title="Arrastra para mover el widget al otro lateral o reordenarlo"
      >
        <span className="widget-grip">⠿</span>
        <span className="widget-title iconlabel">
          {icon} {WIDGET_TITLES[p.widget.kind]}
          {suffix && <span className="widget-suffix">· {suffix}</span>}
        </span>
        <button
          className="widget-btn"
          onClick={() => p.onPatch(p.widget.id, { half: !p.widget.half, ...(p.widget.half ? {} : { width: undefined }) })}
          title={
            p.widget.half
              ? 'Ocupar todo el ancho de la columna'
              : 'Media columna: se acopla lado a lado con otro widget'
          }
        >
          {p.widget.half ? '▭' : '◫'}
        </button>
        <button className="widget-btn" onClick={() => p.onRemove(p.widget.id)} title="Quitar widget">
          <IconX size={11} />
        </button>
      </div>
      <div className="widget-body">
        {p.widget.kind === 'git' && (
          <GitWidget widget={p.widget} tab={p.tab} visible={p.visible} onConfig={patchConfig} />
        )}
        {p.widget.kind === 'board' && (
          <BoardWidget widget={p.widget} tab={p.tab} visible={p.visible} onConfig={patchConfig} />
        )}
        {p.widget.kind === 'agents' && (
          <AgentsWidget agents={p.agents} todos={p.todos} onOpenSubagent={p.onOpenSubagent} />
        )}
        {p.widget.kind === 'health' && <HealthWidget tab={p.tab} />}
        {p.widget.kind === 'tasks' && <TasksWidget todos={p.todos} />}
        {p.widget.kind === 'ci' && <CiWidget tab={p.tab} visible={p.visible} />}
        {p.widget.kind === 'prs' && <PrsWidget tab={p.tab} visible={p.visible} />}
        {p.widget.kind === 'notes' && <NotesWidget widget={p.widget} onConfig={patchConfig} />}
      </div>
      <div
        className="widget-resize"
        onMouseDown={(e) => {
          e.preventDefault()
          // si la altura era automática, partir de la altura real actual
          if (liveHeight <= 0 && rootRef.current) setLiveHeight(rootRef.current.offsetHeight)
          startHeightDrag()
        }}
        title="Arrastra para cambiar la altura"
      />
      {/* asa lateral: ancho propio de ESTE widget (el dock se adapta al mayor) */}
      <div
        className="widget-resize-x"
        style={p.widget.side === 'left' ? { right: 0 } : { left: 0 }}
        title="Arrastra para cambiar el ancho de este widget"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const startX = e.clientX
          const startW = rootRef.current?.offsetWidth ?? 300
          const dir = p.widget.side === 'left' ? 1 : -1
          const onMove = (ev: PointerEvent): void => {
            const w = Math.min(640, Math.max(220, startW + dir * (ev.clientX - startX)))
            if (rootRef.current) rootRef.current.style.width = `${w}px`
          }
          const onUp = (ev: PointerEvent): void => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            const w = Math.min(640, Math.max(220, startW + dir * (ev.clientX - startX)))
            propsRef.current.onPatch(propsRef.current.widget.id, { width: w, half: false })
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        }}
      />
    </div>
  )
})

// ---------- Widget: Git ----------

const GitWidget = memo(function GitWidget(p: {
  widget: WidgetState
  tab: TabState
  visible: boolean
  onConfig: (c: WidgetState['config']) => void
}): React.JSX.Element {
  const repoPath = p.widget.config.repoPath || p.tab.cwd
  const [info, setInfo] = useState<GitInfo | null>(null)

  const refresh = useCallback(async () => {
    setInfo(await window.deck.gitInfo(repoPath))
  }, [repoPath])

  // Los widgets de pestañas ocultas NO consultan: sin esto, 5 pestañas con
  // widget git lanzaban 25 procesos git cada 20 s en segundo plano.
  useEffect(() => {
    if (!p.visible) return
    void refresh()
    const t = setInterval(() => void refresh(), 20_000)
    return () => clearInterval(t)
  }, [refresh, p.visible])

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
})

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

const BoardWidget = memo(function BoardWidget(p: {
  widget: WidgetState
  tab: TabState
  visible: boolean
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
    if (configuring || !p.visible) return
    void load()
    const t = setInterval(() => void load(), 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [configuring, load, p.visible])

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
})

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

// ---------- Widget: Salud de la sesión ----------

/** Formatea tokens: 1234 → «1,2k», 156000 → «156k», 1000000 → «1M» */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * Estado de la sesión de Claude: cuánta ventana de contexto va ocupada (con
 * alerta cuando conviene un /compact), tokens de salida, turnos y costo.
 * Los datos llegan del usage que el SDK reporta en cada respuesta.
 */
function HealthWidget(p: { tab: TabState }): React.JSX.Element {
  const [health, setHealth] = useState<ChatHealth | null>(null)

  useEffect(() => {
    setHealth(null)
    void window.deck.chatHealth(p.tab.id).then((h) => h && h.contextTokens > 0 && setHealth(h))
    return window.deck.onChatHealth((h) => {
      if (h.tabId === p.tab.id) setHealth(h)
    })
  }, [p.tab.id])

  if (!health || health.contextTokens === 0) {
    return (
      <p className="hint" style={{ padding: 8 }}>
        Aún no hay datos: se llenan con la primera respuesta de Claude en esta sesión.
      </p>
    )
  }

  const pct = health.contextWindow > 0 ? health.contextTokens / health.contextWindow : 0
  const level = pct >= 0.8 ? 'danger' : pct >= 0.6 ? 'warn' : 'ok'

  // Uso de la sesión = lo consumido frente a los límites que fijó el usuario
  // (presupuesto US$ y máximo de turnos); manda el más avanzado de los dos.
  const budgetUsd = p.tab.llmParams?.maxBudgetUsd ?? 0
  const maxTurns = p.tab.llmParams?.maxTurns ?? 0
  const usagePct = Math.max(
    budgetUsd > 0 ? health.costUsd / budgetUsd : 0,
    maxTurns > 0 ? health.numTurns / maxTurns : 0
  )
  const usageLevel = usagePct >= 0.8 ? 'danger' : usagePct >= 0.6 ? 'warn' : 'ok'

  return (
    <div className="healthw">
      <div className="healthw-row">
        <span className="healthw-label">Contexto</span>
        <span className={`healthw-value ${level}`}>
          {fmtTokens(health.contextTokens)} / {fmtTokens(health.contextWindow)} ·{' '}
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="healthw-bar">
        <div className={`healthw-fill ${level}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      {level === 'danger' && (
        <div className="healthw-alert danger">
          ⚠️ Contexto casi lleno: ejecuta <code>/compact</code> para resumir la conversación (o{' '}
          <code>/clear</code> si quieres empezar de cero).
        </div>
      )}
      {level === 'warn' && (
        <div className="healthw-alert warn">
          El contexto pasó del 60%. Buen momento para un <code>/compact</code> si el hilo es largo.
        </div>
      )}
      {/* Uso de la sesión frente a los límites configurados en Parámetros */}
      {(budgetUsd > 0 || maxTurns > 0) && (
        <>
          <div className="healthw-row" style={{ marginTop: 2 }}>
            <span className="healthw-label">Uso de la sesión</span>
            <span className={`healthw-value ${usageLevel}`}>{Math.round(usagePct * 100)}%</span>
          </div>
          <div className="healthw-bar">
            <div
              className={`healthw-fill ${usageLevel}`}
              style={{ width: `${Math.min(100, usagePct * 100)}%` }}
            />
          </div>
          <div className="healthw-usage">
            {budgetUsd > 0 && (
              <span>
                US$ {health.costUsd.toFixed(2)} / {budgetUsd.toFixed(2)}
              </span>
            )}
            {maxTurns > 0 && (
              <span>
                {health.numTurns} / {maxTurns} turnos
              </span>
            )}
          </div>
        </>
      )}
      <div className="healthw-grid">
        <div className="healthw-stat">
          <span className="healthw-label">Salida acumulada</span>
          <span className="healthw-value">{fmtTokens(health.outputTokens)} tokens</span>
        </div>
        <div className="healthw-stat">
          <span className="healthw-label">Turnos</span>
          <span className="healthw-value">{health.numTurns}</span>
        </div>
        <div className="healthw-stat">
          <span className="healthw-label">Costo sesión</span>
          <span className="healthw-value">US$ {health.costUsd.toFixed(4)}</span>
        </div>
        {health.model && (
          <div className="healthw-stat">
            <span className="healthw-label">Modelo</span>
            <span className="healthw-value" title={health.model}>
              {health.model.replace(/^claude-/, '')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Widgets: Pipelines · Pull requests · Notas ----------

const PROVIDER_NAME: Record<string, string> = {
  github: 'GitHub Actions',
  azure: 'Azure Pipelines',
  bitbucket: 'Bitbucket',
  none: 'sin proveedor'
}

const STATE_ICON: Record<CiBuild['state'], string> = {
  success: '✓',
  failed: '✕',
  running: '◐',
  canceled: '⊘',
  partial: '!',
  unknown: '·'
}

/** Fecha relativa corta: «hace 5 min», «hace 2 h», «hace 3 d» */
function relTime(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** Builds recientes del repo (GitHub Actions, Azure Pipelines o Bitbucket) */
const CiWidget = memo(function CiWidget(p: { tab: TabState; visible: boolean }): React.JSX.Element {
  const [data, setData] = useState<{ ok: boolean; repo: CiRepoInfo; builds: CiBuild[]; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setData(await window.deck.ciBuilds(p.tab.cwd))
    setLoading(false)
  }, [p.tab.cwd])

  useEffect(() => {
    if (!p.visible) return
    void load()
    const t = setInterval(() => void load(), 90_000)
    return () => clearInterval(t)
  }, [load, p.visible])

  return (
    <div className="ciw">
      <div className="widget-toolbar">
        <span className="chip">{PROVIDER_NAME[data?.repo.provider ?? 'none']}</span>
        <span style={{ flex: 1 }} />
        <button className="widget-btn" onClick={() => void load()} title="Refrescar">
          <IconRefresh size={11} />
        </button>
      </div>
      {loading && !data && (
        <p className="hint" style={{ padding: 8 }}>
          <span className="spinner" /> Consultando…
        </p>
      )}
      {data && !data.ok && <div className="validation err" style={{ margin: 8 }}>{data.error}</div>}
      {data?.ok && data.builds.length === 0 && (
        <p className="hint" style={{ padding: 8 }}>No hay ejecuciones recientes.</p>
      )}
      {data?.ok &&
        data.builds.map((b) => (
          <div
            key={b.id}
            className={`ci-row ${b.state}`}
            title={`${b.name} · ${b.branch} · ${b.state}`}
            onClick={() => b.url && window.deck.openTarget(b.url, p.tab.cwd)}
          >
            <span className={`ci-state ${b.state}`}>{STATE_ICON[b.state]}</span>
            <span className="ci-name">{b.name}</span>
            <span className="ci-branch mono">{b.branch}</span>
            <span className="ci-time">{relTime(b.finishedAt)}</span>
          </div>
        ))}
    </div>
  )
})

/** Pull requests abiertos del repo */
const PrsWidget = memo(function PrsWidget(p: { tab: TabState; visible: boolean }): React.JSX.Element {
  const [data, setData] = useState<{ ok: boolean; repo: CiRepoInfo; prs: CiPullRequest[]; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setData(await window.deck.ciPrs(p.tab.cwd))
    setLoading(false)
  }, [p.tab.cwd])

  useEffect(() => {
    if (!p.visible) return
    void load()
    const t = setInterval(() => void load(), 120_000)
    return () => clearInterval(t)
  }, [load, p.visible])

  return (
    <div className="ciw">
      <div className="widget-toolbar">
        <span className="chip">{PROVIDER_NAME[data?.repo.provider ?? 'none']}</span>
        {data?.ok && data.prs.length > 0 && <span className="chip project">{data.prs.length}</span>}
        <span style={{ flex: 1 }} />
        <button className="widget-btn" onClick={() => void load()} title="Refrescar">
          <IconRefresh size={11} />
        </button>
      </div>
      {loading && !data && (
        <p className="hint" style={{ padding: 8 }}>
          <span className="spinner" /> Consultando…
        </p>
      )}
      {data && !data.ok && <div className="validation err" style={{ margin: 8 }}>{data.error}</div>}
      {data?.ok && data.prs.length === 0 && (
        <p className="hint" style={{ padding: 8 }}>No hay pull requests abiertos.</p>
      )}
      {data?.ok &&
        data.prs.map((pr) => (
          <div
            key={pr.id}
            className="pr-row"
            title={`#${pr.id} · ${pr.author} · ${pr.branch}`}
            onClick={() => pr.url && window.deck.openTarget(pr.url, p.tab.cwd)}
          >
            <div className="pr-line">
              <span className="pr-id mono">#{pr.id}</span>
              <span className="pr-title">{pr.title}</span>
              {pr.draft && <span className="cd-badge">borrador</span>}
            </div>
            <div className="pr-meta">
              <span className="mono">{pr.branch}</span>
              {pr.reviewState && <span className="pr-review">{pr.reviewState}</span>}
              {pr.checks !== 'unknown' && (
                <span className={`ci-state ${pr.checks}`}>{STATE_ICON[pr.checks]} checks</span>
              )}
            </div>
          </div>
        ))}
    </div>
  )
})

/** Bloc de notas por widget: texto plano o markdown con vista previa */
function NotesWidget(p: {
  widget: WidgetState
  onConfig: (c: WidgetState['config']) => void
}): React.JSX.Element {
  const [text, setText] = useState(p.widget.config.notes ?? '')
  const preview = Boolean(p.widget.config.notesPreview)
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  const cfgRef = useRef(p.widget.config)
  cfgRef.current = p.widget.config

  // guardado diferido: no persistir en cada tecla
  const onChange = (v: string): void => {
    setText(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => p.onConfig({ ...cfgRef.current, notes: v }), 600)
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return (
    <div className="notesw">
      <div className="widget-toolbar">
        <button
          className="widget-btn"
          onClick={() => p.onConfig({ ...cfgRef.current, notes: text, notesPreview: !preview })}
          title={preview ? 'Editar' : 'Ver como markdown'}
        >
          {preview ? '✎ editar' : '👁 markdown'}
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="widget-btn"
          title="Copiar todo"
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          ⧉
        </button>
      </div>
      {preview ? (
        <div className="notesw-preview">
          {text.trim() ? <Markdown text={text} /> : <p className="hint">Sin notas todavía.</p>}
        </div>
      ) : (
        <textarea
          className="notesw-input"
          value={text}
          placeholder="Notas de esta sesión… (texto plano o markdown)"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

// ---------- Widget: Tareas (plan de Claude, espejo de TodoWrite) ----------

/**
 * El plan que Claude va armando con TodoWrite, como una lista de tareas con
 * barra de progreso: ✓ completada · ◐ en curso (muestra su forma activa) ·
 * ○ pendiente. Se actualiza en vivo con cada cambio del plan.
 */
const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '○ Pendiente',
  in_progress: '◐ En curso',
  completed: '✓ Completada'
}

function TasksWidget(p: { todos: TodoItem[] }): React.JSX.Element {
  const [detail, setDetail] = useState<TodoItem | null>(null)
  if (p.todos.length === 0) {
    return (
      <p className="hint" style={{ padding: 8 }}>
        Cuando Claude planifique con tareas, aquí verás el plan y su avance en vivo.
      </p>
    )
  }
  const done = p.todos.filter((t) => t.status === 'completed').length
  const pct = Math.round((done / p.todos.length) * 100)
  return (
    <div className="tasksw">
      <div className="tasksw-progress">
        <div className="healthw-bar" style={{ flex: 1 }}>
          <div className="healthw-fill ok" style={{ width: `${pct}%` }} />
        </div>
        <span className="tasksw-count">
          {done}/{p.todos.length}
        </span>
      </div>
      {p.todos.map((t, i) => (
        <div
          key={i}
          className={`task-item ${t.status}`}
          style={{ cursor: 'pointer' }}
          title="Ver el detalle de la tarea"
          onClick={() => setDetail(t)}
        >
          <span className="task-icon">
            {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
          </span>
          <span className="task-text">
            {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
          </span>
        </div>
      ))}
      {detail && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal task-detail">
            <div className="modal-head">
              <h3>📋 Detalle de la tarea</h3>
              <span className={`chip ${detail.status === 'completed' ? 'project' : ''}`}>
                {TASK_STATUS_LABEL[detail.status] ?? detail.status}
              </span>
              <button className="widget-btn" onClick={() => setDetail(null)} title="Cerrar">
                <IconX size={12} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0 }}>{detail.content}</p>
              {detail.activeForm && detail.status === 'in_progress' && (
                <p className="hint" style={{ marginTop: 8 }}>
                  Ahora mismo: {detail.activeForm}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
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
