import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaneLayout, TabState, TabStatus } from '../../shared/types'
import { PANE_COUNT, paneTabId } from '../../shared/types'
import { TabBar } from './components/TabBar'
import { ChatTabView } from './components/ChatTabView'
import { LayoutPicker, PaneGrid } from './components/PaneGrid'
import { ConfigPanel } from './components/ConfigPanel'
import { CommandPalette } from './components/CommandPalette'
import { SearchModal } from './components/SearchModal'
import { NewTabDialog } from './components/NewTabDialog'
import { SessionsPanel } from './components/SessionsPanel'
import { StoreModal } from './components/StoreModal'
import { SettingsModal } from './components/SettingsModal'
import type { WidgetKind, WidgetState } from '../../shared/types'

export default function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, TabStatus>>({})
  const [exitedPanes, setExitedPanes] = useState<Record<string, boolean>>({})
  const [showConfig, setShowConfig] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showNewTab, setShowNewTab] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [showStore, setShowStore] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  /** Snap de pestañas (mockup 2b): zona candidata mientras se arrastra una pestaña */
  const [snapDrag, setSnapDrag] = useState(false)
  const [snapZone, setSnapZone] = useState<{
    layout: PaneLayout
    cell: number
    rect: { left: number; top: number; width: number; height: number }
  } | null>(null)
  const termsRef = useRef<HTMLDivElement | null>(null)

  // El botón ⌘ del composer del chat abre la paleta con este evento
  useEffect(() => {
    const onOpen = (): void => setShowPalette(true)
    window.addEventListener('deck:open-palette', onOpen)
    return () => window.removeEventListener('deck:open-palette', onOpen)
  }, [])

  // Snap de pestañas (mockup 2b): zonas de borde (umbral 40px) → vista previa
  // de mitad/cuadrante; selector de layouts arriba; soltar divide y asigna.
  const snapFns = useRef({ changeWsLayout: (_l: PaneLayout) => {}, assignCell: (_i: number, _t: string) => {} })
  useEffect(() => {
    const T = 40
    const compute = (
      x: number,
      y: number
    ): { layout: PaneLayout; cell: number; rect: { left: number; top: number; width: number; height: number } } | null => {
      // 1) ¿está sobre una opción del selector de layouts?
      const pick = document
        .elementsFromPoint(x, y)
        .find((el) => (el as HTMLElement).dataset?.snapLayout) as HTMLElement | undefined
      const host = termsRef.current?.getBoundingClientRect()
      if (!host) return null
      const half = (layout: PaneLayout, cell: number): { layout: PaneLayout; cell: number; rect: { left: number; top: number; width: number; height: number } } => {
        const w2 = host.width / 2
        const h2 = host.height / 2
        const rect =
          layout === 'cols'
            ? { left: host.left + (cell === 1 ? w2 : 0), top: host.top, width: w2, height: host.height }
            : layout === 'rows'
              ? { left: host.left, top: host.top + (cell === 1 ? h2 : 0), width: host.width, height: h2 }
              : {
                  left: host.left + (cell % 2 === 1 ? w2 : 0),
                  top: host.top + (cell >= 2 ? h2 : 0),
                  width: w2,
                  height: h2
                }
        return { layout, cell, rect }
      }
      if (pick) return half(pick.dataset.snapLayout as PaneLayout, 0)
      // 2) proximidad a bordes del área de trabajo
      if (x < host.left || x > host.right || y < host.top || y > host.bottom) return null
      const nearL = x < host.left + T
      const nearR = x > host.right - T
      const nearT = y < host.top + T
      const nearB = y > host.bottom - T
      if ((nearL || nearR) && (nearT || nearB)) return half('grid', (nearB ? 2 : 0) + (nearR ? 1 : 0))
      if (nearL) return half('cols', 0)
      if (nearR) return half('cols', 1)
      if (nearT) return half('rows', 0)
      if (nearB) return half('rows', 1)
      return null
    }
    const onDrag = (e: Event): void => {
      const { phase, tabId, x, y } = (e as CustomEvent).detail as {
        phase: string
        tabId: string
        x: number
        y: number
      }
      if (phase === 'cancel') {
        setSnapDrag(false)
        setSnapZone(null)
        return
      }
      if (phase === 'start') setSnapDrag(true)
      if (phase === 'start' || phase === 'move') {
        setSnapZone(compute(x, y))
        return
      }
      if (phase === 'drop') {
        const zone = compute(x, y)
        setSnapDrag(false)
        setSnapZone(null)
        if (zone) {
          snapFns.current.changeWsLayout(zone.layout)
          snapFns.current.assignCell(zone.cell, tabId)
        }
      }
    }
    window.addEventListener('deck:tabdrag', onDrag)
    return () => window.removeEventListener('deck:tabdrag', onDrag)
  }, [])
  /** Widgets por pestaña: cada chat tiene su propio layout */
  const [tabWidgets, setTabWidgets] = useState<Record<string, WidgetState[]>>({})

  // cargar los widgets de las pestañas que aún no tienen entrada
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.mode === 'chat' && !(tab.id in tabWidgets)) {
        void window.deck.widgetsGet(tab.id).then((ws) => {
          setTabWidgets((tw) => (tab.id in tw ? tw : { ...tw, [tab.id]: ws }))
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs])

  const changeWidgets = useCallback((tabId: string, next: WidgetState[]) => {
    setTabWidgets((tw) => ({ ...tw, [tabId]: next }))
    void window.deck.widgetsSet(tabId, next)
  }, [])

  /** Agrega SIEMPRE un widget nuevo del tipo a la pestaña ACTIVA (se pueden
   *  repetir, p.ej. dos widgets de git vigilando repos distintos). El lado
   *  puede venir del drag&drop de la galería. */
  const addWidget = useCallback((kind: WidgetKind, side?: WidgetState['side']) => {
    const tabId = activeIdRef.current
    if (!tabId) return
    setTabWidgets((tw) => {
      const next = [
        ...(tw[tabId] ?? []),
        {
          id: `w-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          kind,
          side: side ?? ((kind === 'git' ? 'left' : 'right') as WidgetState['side']),
          order: 99,
          // 0 = altura automática (contenido); el usuario puede fijarla con el asa
          height: 0,
          config: {}
        }
      ]
      void window.deck.widgetsSet(tabId, next)
      return { ...tw, [tabId]: next }
    })
  }, [])
  const [update, setUpdate] = useState<{
    version: string
    installerPath?: string
    url?: string
  } | null>(null)
  const [dlPct, setDlPct] = useState<number | null>(null)
  const [updateErr, setUpdateErr] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [upToDate, setUpToDate] = useState(false)
  /** División del área de trabajo: 1, 2 o 4 chats a la vez (cada uno con su terminal) */
  const [wsLayout, setWsLayout] = useState<PaneLayout>('single')
  const [cells, setCells] = useState<(string | null)[]>([null, null, null, null])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const cellsRef = useRef(cells)
  cellsRef.current = cells
  const wsLayoutRef = useRef(wsLayout)
  wsLayoutRef.current = wsLayout

  useEffect(() => {
    void window.deck.appVersion().then(setAppVersion)
    const off = window.deck.onUpdateAvailable(setUpdate)
    const offProgress = window.deck.onUpdateProgress(({ percent }) => setDlPct(percent))
    return () => {
      off()
      offProgress()
    }
  }, [])

  // Las actualizaciones llegan de GitHub Releases (y de la carpeta local o
  // compartida si está configurada); el chequeo manual consulta en vivo.
  const checkUpdates = useCallback(async () => {
    const info = await window.deck.updateCheck()
    if (info) {
      setUpdate(info)
    } else {
      setUpToDate(true)
      setTimeout(() => setUpToDate(false), 2500)
    }
  }, [])

  useEffect(() => {
    void window.deck.listTabs().then(({ tabs, activeTabId }) => {
      setTabs(tabs)
      setActiveId(activeTabId ?? tabs[0]?.id ?? null)
    })

    const offStatus = window.deck.onTabStatus(({ tabId, status, detail }) => {
      setStatuses((s) => ({ ...s, [tabId]: status }))
      if ((status === 'done' || status === 'attention') && !document.hasFocus()) {
        const tab = tabsRef.current.find((t) => t.id === tabId)
        try {
          new Notification(`Claude Deck — ${tab?.title ?? 'pestaña'}`, {
            body: detail ?? (status === 'done' ? 'Tarea terminada' : 'Requiere tu atención')
          })
        } catch {
          /* notificaciones no disponibles */
        }
      }
    })
    const offSession = window.deck.onTabSession(({ tabId, sessionId }) => {
      setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, claudeSessionId: sessionId } : t)))
    })
    const offExit = window.deck.onPtyExit(({ paneId }) => {
      setExitedPanes((e) => ({ ...e, [paneId]: true }))
      const tabId = paneTabId(paneId)
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (tab && tab.mode !== 'chat' && paneId === tabId) {
        setStatuses((s) => ({ ...s, [tabId]: 'exited' }))
      }
    })
    return () => {
      offStatus()
      offSession()
      offExit()
    }
  }, [])

  /** Ids visibles según la división del workspace */
  const visibleCount = PANE_COUNT[wsLayout]
  const visibleIds =
    wsLayout === 'single'
      ? new Set(activeId ? [activeId] : [])
      : new Set(cells.slice(0, visibleCount).filter((c): c is string => c !== null))

  const changeWsLayout = useCallback((layout: PaneLayout) => {
    setWsLayout(layout)
    if (layout !== 'single') {
      setCells(() => {
        const list = tabsRef.current
        const count = PANE_COUNT[layout]
        const ordered = [
          activeIdRef.current,
          ...list.map((t) => t.id).filter((id) => id !== activeIdRef.current)
        ].filter(Boolean) as string[]
        const next: (string | null)[] = [null, null, null, null]
        for (let i = 0; i < count; i++) next[i] = ordered[i] ?? null
        return next
      })
    }
  }, [])

  const activate = useCallback((tabId: string) => {
    setActiveId(tabId)
    setStatuses((s) => (s[tabId] === 'done' ? { ...s, [tabId]: 'idle' } : s))
    void window.deck.activateTab(tabId)
    // En modo dividido, si la pestaña no está visible ocupa la celda del activo anterior
    if (wsLayoutRef.current !== 'single') {
      setCells((cs) => {
        const count = PANE_COUNT[wsLayoutRef.current]
        if (cs.slice(0, count).includes(tabId)) return cs
        const replaceIdx = Math.max(0, cs.findIndex((c) => c === activeIdRef.current))
        const next = [...cs]
        next[replaceIdx < count ? replaceIdx : 0] = tabId
        return next
      })
    }
  }, [])

  const assignCell = useCallback((index: number, tabId: string) => {
    setCells((cs) => {
      const next = [...cs]
      // si ya estaba en otra celda, intercambiar
      const prevIdx = next.findIndex((c) => c === tabId)
      if (prevIdx >= 0) next[prevIdx] = next[index]
      next[index] = tabId
      return next
    })
    setActiveId(tabId)
  }, [])

  // funciones vivas para el listener de snap (declarado antes con deps vacías)
  snapFns.current = { changeWsLayout, assignCell }

  /** Cambia a otra pestaña por desplazamiento circular o índice directo */
  const switchTab = useCallback(
    (delta: number | null, index?: number) => {
      const list = tabsRef.current
      if (list.length === 0) return
      let next: TabState | undefined
      if (delta !== null) {
        const cur = Math.max(0, list.findIndex((t) => t.id === activeIdRef.current))
        next = list[(cur + delta + list.length) % list.length]
      } else if (index !== undefined) {
        next = index >= 8 ? list.at(-1) : list[index]
      }
      if (next) activate(next.id)
    },
    [activate]
  )

  // Atajos globales (los TerminalView dejan pasar estas combinaciones)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.code === 'Tab') {
        e.preventDefault()
        switchTab(e.shiftKey ? -1 : 1)
        return
      }
      const digit = e.code.match(/^Digit([1-9])$/)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && digit) {
        e.preventDefault()
        switchTab(null, parseInt(digit[1], 10) - 1)
        return
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        setShowPalette((v) => !v)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        setShowSearch((v) => !v)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault()
        setShowNewTab(true)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault()
        setShowConfig((v) => !v)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyH') {
        e.preventDefault()
        setShowSessions((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [switchTab])

  const closeTab = useCallback(async (tabId: string) => {
    const remaining = await window.deck.closeTab(tabId)
    setTabs(remaining)
    setCells((cs) => cs.map((c) => (c === tabId ? null : c)))
    setActiveId((cur) => (cur === tabId ? (remaining.at(-1)?.id ?? null) : cur))
  }, [])

  const restartPane = useCallback((paneId: string) => {
    setExitedPanes((e) => {
      const next = { ...e }
      delete next[paneId]
      return next
    })
    const tabId = paneTabId(paneId)
    setStatuses((s) => (s[tabId] === 'exited' ? { ...s, [tabId]: 'idle' } : s))
    void window.deck.restartPane(paneId)
  }, [])

  const patchTab = useCallback((updated: TabState) => {
    setTabs((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
  }, [])

  const activeTab = tabs.find((t) => t.id === activeId) ?? null

  const renderTabContent = (tab: TabState): React.JSX.Element =>
    tab.mode === 'chat' ? (
      <ChatTabView
        tab={tab}
        visible={visibleIds.has(tab.id)}
        exitedPanes={exitedPanes}
        widgets={tabWidgets[tab.id] ?? []}
        onWidgetsChange={changeWidgets}
        onRestartPane={restartPane}
        onLayoutChange={patchTab}
      />
    ) : (
      <div
        className="classic-tab"
        style={{ display: visibleIds.has(tab.id) ? 'flex' : 'none' }}
      >
        <div className="classic-toolbar">
          <span className="hint">⌨ Terminal clásico</span>
          <LayoutPicker
            layout={tab.paneLayout ?? 'single'}
            onChange={(l) => {
              void window.deck.setPaneLayout(tab.id, l).then((u) => u && patchTab(u))
            }}
          />
        </div>
        <div className="classic-body">
          <PaneGrid
            tab={tab}
            visible={visibleIds.has(tab.id)}
            exitedPanes={exitedPanes}
            onRestartPane={restartPane}
            mainRestartLabel="Relanzar (continúa la sesión)"
          />
        </div>
      </div>
    )

  const split = wsLayout !== 'single'

  return (
    <div className="app">
      {update && (
        <div className="update-banner">
          <span>
            🚀 Hay una versión nueva de Claude Deck (<b>v{update.version}</b>)
            {update.url && !update.installerPath ? ' en GitHub.' : ' lista para instalar.'}
            {updateErr && <span style={{ color: 'var(--red)' }}> {updateErr}</span>}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="iconbtn primary"
              disabled={dlPct !== null}
              onClick={() => {
                setUpdateErr('')
                setDlPct(update.url && !update.installerPath ? 0 : null)
                window.deck.updateInstall(update).catch((e) => {
                  setDlPct(null)
                  setUpdateErr(`No se pudo descargar: ${String(e).slice(0, 200)}`)
                })
              }}
              title="Instala en silencio y relanza la app; tus pestañas y sesiones se conservan"
            >
              {dlPct !== null ? `Descargando… ${dlPct}%` : 'Instalar y reiniciar'}
            </button>
            <button className="iconbtn" disabled={dlPct !== null} onClick={() => setUpdate(null)}>
              Después
            </button>
          </div>
        </div>
      )}
      <TabBar
        tabs={tabs}
        activeId={activeId}
        statuses={statuses}
        wsLayout={wsLayout}
        onWsLayout={changeWsLayout}
        onActivate={activate}
        onClose={closeTab}
        onNew={() => setShowNewTab(true)}
        onSearch={() => setShowSearch(true)}
        onPalette={() => setShowPalette(true)}
        onToggleConfig={() => setShowConfig((v) => !v)}
        onToggleSessions={() => setShowSessions((v) => !v)}
        onAddWidget={addWidget}
        onToggleStore={() => setShowStore(true)}
        onToggleSettings={() => setShowSettings(true)}
      />
      <div className="body">
        {showSessions && activeTab && (
          <SessionsPanel tab={activeTab} onClose={() => setShowSessions(false)} />
        )}
        <div className={`terminals ws-${wsLayout}`} ref={termsRef}>
          {tabs.length === 0 && (
            <div className="empty-state">
              <h2>Claude Deck {appVersion && <span className="chip">v{appVersion}</span>}</h2>
              <p>Abre una pestaña para iniciar una sesión de Claude Code en un proyecto.</p>
              <button className="iconbtn primary" onClick={() => setShowNewTab(true)}>
                + Nueva pestaña (Ctrl+Shift+T)
              </button>
              <p>
                <kbd>Ctrl+Shift+P</kbd> paleta · <kbd>Ctrl+Shift+F</kbd> buscar chats ·{' '}
                <kbd>Ctrl+Shift+G</kbd> configuración · <kbd>Ctrl+`</kbd> terminal
              </p>
            </div>
          )}
          {tabs.map((tab) => {
            const cellIdx = split ? cells.slice(0, visibleCount).indexOf(tab.id) : -1
            const inCell = split && cellIdx >= 0
            return (
              <div
                key={tab.id}
                className={`ws-slot ${split ? (inCell ? 'in-grid' : 'off-grid') : 'single-mode'} ${
                  inCell && tab.id === activeId ? 'ws-active' : ''
                }`}
                style={inCell ? { order: cellIdx } : undefined}
                onMouseDownCapture={() => {
                  if (inCell && tab.id !== activeId) activate(tab.id)
                }}
              >
                {inCell && (
                  <div className="ws-cell-bar">
                    <select
                      value={tab.id}
                      onChange={(e) => assignCell(cellIdx, e.target.value)}
                      title="Elegir qué pestaña se muestra en esta celda"
                    >
                      {tabs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.mode === 'chat' ? '💬' : '⌨'} {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="ws-slot-body">{renderTabContent(tab)}</div>
              </div>
            )
          })}
        </div>
        {showConfig && activeTab && <ConfigPanel tab={activeTab} onClose={() => setShowConfig(false)} />}
      </div>
      {activeTab && (
        <div className="statusline">
          <span
            className="path"
            title="Cambiar carpeta de la pestaña"
            onClick={() => {
              void (async () => {
                const cwd = await window.deck.pickFolder()
                if (!cwd || !activeTab) return
                const updated = await window.deck.setTabCwd(activeTab.id, cwd)
                if (updated) {
                  setTabs((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
                }
              })()
            }}
          >
            📁 {activeTab.cwd}
          </span>
          <span className="chip">{activeTab.mode === 'chat' ? '💬 chat' : '⌨ terminal'}</span>
          {activeTab.claudeSessionId && (
            <span className="session" title="Session id de Claude Code (se reanuda al reiniciar)">
              ⏺ {activeTab.claudeSessionId.slice(0, 8)}…
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span>
            <kbd>Ctrl+Shift+P</kbd> paleta · <kbd>Ctrl+Shift+F</kbd> chats
          </span>
          {appVersion && (
            <span
              className="chip clickable"
              title="Versión instalada — clic: buscar actualizaciones · clic derecho: elegir la carpeta de actualizaciones (compartida del equipo)"
              onClick={() => void checkUpdates()}
              onContextMenu={(e) => {
                e.preventDefault()
                void (async () => {
                  const dir = await window.deck.pickFolder()
                  if (dir) {
                    await window.deck.updateSetDir(dir)
                    setUpToDate(true)
                    setTimeout(() => setUpToDate(false), 2500)
                  }
                })()
              }}
            >
              {upToDate ? '✓ al día' : `v${appVersion}`}
            </span>
          )}
        </div>
      )}
      {showPalette && (
        <CommandPalette
          activeTab={activeTab}
          onClose={() => setShowPalette(false)}
          onInsert={(text, submit) => {
            if (activeTab) {
              if (activeTab.mode === 'chat') {
                window.dispatchEvent(
                  new CustomEvent('deck:chat-insert', {
                    detail: { tabId: activeTab.id, text, submit }
                  })
                )
              } else {
                window.deck.ptyInput(activeTab.id, text + (submit ? '\r' : ''))
              }
            }
            setShowPalette(false)
          }}
        />
      )}
      {showStore && (
        <StoreModal
          tab={activeTab ?? null}
          onClose={() => setShowStore(false)}
          onAddWidget={addWidget}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {/* Snap de pestañas (2b): vista previa de la zona + selector de layouts */}
      {snapZone && (
        <div
          className="snap-preview"
          style={{
            left: snapZone.rect.left,
            top: snapZone.rect.top,
            width: snapZone.rect.width,
            height: snapZone.rect.height
          }}
        />
      )}
      {snapDrag && termsRef.current && (
        <div
          className="snap-picker"
          style={{
            left: termsRef.current.getBoundingClientRect().left + termsRef.current.clientWidth / 2,
            top: termsRef.current.getBoundingClientRect().top + 14
          }}
        >
          <div className="snap-pick" data-snap-layout="cols" title="Dos columnas">
            <span /><span className="hot" />
          </div>
          <div className="snap-pick rows" data-snap-layout="rows" title="Dos filas">
            <span /><span className="hot" />
          </div>
          <div className="snap-pick grid" data-snap-layout="grid" title="Cuadrícula 2×2">
            <span className="hot" /><span /><span /><span />
          </div>
        </div>
      )}
      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onOpen={async (cwd, sessionId) => {
            const tab = await window.deck.openChat(cwd, sessionId)
            setTabs((ts) => [...ts, tab])
            activate(tab.id)
            setShowSearch(false)
          }}
        />
      )}

      {showNewTab && (
        <NewTabDialog
          onClose={() => setShowNewTab(false)}
          onCreated={(tab) => {
            setTabs((ts) => [...ts, tab])
            activate(tab.id)
            setShowNewTab(false)
          }}
        />
      )}
    </div>
  )
}
