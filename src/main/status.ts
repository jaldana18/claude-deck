import type { BrowserWindow } from 'electron'
import type {
  ModelFault,
  ServiceComponent,
  ServiceLevel,
  StatusIncident,
  StatusReport
} from '../shared/types'
import {
  familiasCitadas,
  fallosVigentes,
  modelosDegradados,
  nivelDeComponente,
  nivelGlobal,
  nuevoFallo,
  UMBRAL_FALLOS
} from '../shared/status'
import type { Store } from './store'

/** Statuspage público de Anthropic. Sin auth y sin rate limit relevante. */
const STATUS_URL = 'https://status.anthropic.com/api/v2/summary.json'

/** Cada cuánto se consulta el status oficial en segundo plano */
const INTERVALO_MS = 5 * 60 * 1000
/** Freno para el chequeo disparado al enfocar la ventana */
const THROTTLE_FOCO_MS = 60 * 1000
/** Tope de fallos guardados, para que la lista no crezca sin control */
const MAX_FALLOS = 50

interface SummaryJson {
  status?: { indicator?: string; description?: string }
  components?: { name?: string; status?: string; group?: boolean }[]
  incidents?: {
    id?: string
    name?: string
    status?: string
    impact?: string
    shortlink?: string
    created_at?: string
    incident_updates?: { body?: string }[]
  }[]
}

/**
 * Vigila si Claude está caído, combinando dos fuentes que se compensan:
 *
 *  - El status oficial, que es autoritativo pero grueso (servicios, no modelos)
 *    y llega tarde: Anthropic abre el incidente cuando ya lo ha confirmado.
 *  - Los fallos de API observados en esta máquina, que son inmediatos y sí
 *    apuntan a un modelo concreto, pero pueden ser ruido local (tu red, un
 *    pico puntual). Por eso hace falta un umbral antes de dar nada por caído.
 */
export class StatusWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastFocusCheck = 0
  private lastFocoAt = 0

  private nivel: ServiceLevel | null = null
  private resumen = ''
  private componentes: ServiceComponent[] = []
  private incidentes: StatusIncident[] = []
  private fallos: ModelFault[] = []
  private checkedAt = 0

  /** Firma del último aviso emitido, para no repetir el mismo banner */
  private avisado = ''

  constructor(
    private getWindow: () => BrowserWindow | null,
    private store: Store
  ) {}

  private get activo(): boolean {
    return this.store.globalSettings.statusAlerts !== false
  }

  private get umbral(): number {
    const n = this.store.globalSettings.statusFaultThreshold
    return n && n > 0 ? n : UMBRAL_FALLOS
  }

  startAutoCheck(): void {
    // Igual que el updater: margen al arrancar para no competir con el arranque
    setTimeout(() => void this.check(), 20_000)
    this.timer = setInterval(() => void this.check(), INTERVALO_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onWindowFocus(): void {
    const now = Date.now()
    if (now - this.lastFocusCheck < THROTTLE_FOCO_MS) return
    this.lastFocusCheck = now
    void this.check()
  }

  /**
   * Registra un fallo de API contra un modelo. Lo llama la sesión de chat
   * cuando el SDK anuncia un reintento (`api_retry`) o cuando un turno acaba
   * en error de modelo/API.
   */
  recordFault(model: string | undefined, status: number | null, message: string): void {
    if (!this.activo) return
    this.fallos.unshift(nuevoFallo(model, status, message))
    if (this.fallos.length > MAX_FALLOS) this.fallos.length = MAX_FALLOS
    this.emitIfChanged()
  }

  /**
   * Un turno que sale bien limpia los fallos de ese modelo: sin esto, un pico
   * de 30 segundos dejaría el aviso encendido durante toda la ventana de
   * observación aunque el modelo ya hubiera vuelto.
   */
  recordSuccess(model: string | undefined): void {
    const m = model || 'default'
    const antes = this.fallos.length
    this.fallos = this.fallos.filter((f) => f.model !== m)
    if (this.fallos.length !== antes) this.emitIfChanged()
  }

  private podar(): void {
    this.fallos = fallosVigentes(this.fallos, Date.now())
  }

  /** Modelos que superan el umbral de fallos dentro de la ventana */
  private degradados(): string[] {
    this.podar()
    return modelosDegradados(this.fallos, this.umbral)
  }

  report(): StatusReport {
    return {
      checkedAt: this.checkedAt,
      level: this.nivel,
      summary: this.resumen,
      components: this.componentes,
      incidents: this.incidentes,
      faults: (this.podar(), this.fallos.slice(0, 20)),
      degraded: this.degradados()
    }
  }

  /** Consulta el status oficial. `force` salta el freno de foco. */
  async check(force = false): Promise<StatusReport> {
    if (!this.activo && !force) return this.report()
    const now = Date.now()
    if (!force && now - this.lastFocoAt < 30_000) return this.report()
    this.lastFocoAt = now

    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 10_000)
      const res = await fetch(STATUS_URL, {
        signal: ctl.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'claude-deck-status' }
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as SummaryJson

      this.nivel = nivelGlobal(data.status?.indicator ?? '')
      this.resumen = data.status?.description ?? ''
      this.componentes = (data.components ?? [])
        .filter((c) => !c.group && c.name)
        .map((c) => ({ name: c.name as string, level: nivelDeComponente(c.status ?? '') }))
      this.incidentes = (data.incidents ?? []).map((i) => {
        const cuerpo = i.incident_updates?.[0]?.body ?? ''
        return {
          id: i.id ?? '',
          name: i.name ?? 'Incidente sin título',
          stage: i.status ?? 'investigating',
          impact: (i.impact as StatusIncident['impact']) ?? 'minor',
          url: i.shortlink ?? 'https://status.claude.com',
          startedAt: i.created_at ?? '',
          families: familiasCitadas(`${i.name ?? ''} ${cuerpo}`)
        }
      })
      this.checkedAt = Date.now()
    } catch {
      // Sin red o status caído: se conserva lo último conocido y se marca que
      // la fuente oficial no responde. Los fallos locales siguen contando.
      this.nivel = null
      this.checkedAt = Date.now()
    }

    this.emitIfChanged()
    return this.report()
  }

  /**
   * Envía al renderer solo cuando cambia algo que el usuario vería. Sin esta
   * guarda, cada sondeo repintaría el banner y lo volvería imposible de cerrar.
   */
  private emitIfChanged(): void {
    const rep = this.report()
    const firma = [
      rep.level ?? 'sin-datos',
      rep.degraded.join(','),
      rep.incidents.map((i) => `${i.id}:${i.stage}`).join(',')
    ].join('|')
    if (firma === this.avisado) return
    this.avisado = firma
    try {
      const win = this.getWindow()
      if (win && !win.isDestroyed()) win.webContents.send('status:changed', rep)
    } catch {
      /* ventana cerrándose */
    }
  }
}
