import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Bus } from '../bus'
import type { Ownership } from '../ownership'
import { eventoRemoto } from './api'
import type { Auth } from './auth'
import type { Dispatcher } from './dispatch'

/**
 * Servidor del acceso remoto: sirve el cliente web y atiende su API.
 *
 * Los eventos van por HTTP en streaming (una línea de JSON por evento) y no por
 * WebSocket. No es por ahorrar una dependencia: con un WebSocket el token viaja
 * en el upgrade y hay que acordarse de comprobarlo ahí, que es exactamente el
 * descuido que deja una puerta abierta. Aquí toda petición, incluida la del
 * canal de eventos, pasa por el mismo sitio y lleva su cabecera.
 *
 * El servidor escucha en 127.0.0.1: quien sale a internet es cloudflared, que
 * se conecta por dentro. Solo se abre a la red cuando no hay túnel.
 */

const LATIDO_MS = 20_000
/** Adjuntos desde el móvil: una foto de cámara pasa del megabyte. */
const CUERPO_MAX = 8 * 1024 * 1024
/** Un cliente que no lee se desengancha en vez de hinchar la memoria del main. */
const ATASCO_MAX = 4 * 1024 * 1024

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

interface Flujo {
  clientId: string
  res: ServerResponse
  latido: NodeJS.Timeout
}

export interface GatewayDeps {
  bus: Bus
  auth: Auth
  dispatcher: Dispatcher
  ownership: Ownership
  /** Carpeta con el cliente web compilado. */
  webDir: string
}

export class Gateway {
  private server: Server | null = null
  private flujos = new Set<Flujo>()
  private desuscribir: (() => void) | null = null

  constructor(private deps: GatewayDeps) {}

  get escuchando(): boolean {
    return this.server !== null
  }

  /** Dispositivos con el canal de eventos abierto ahora mismo. */
  get conectados(): string[] {
    return [...new Set([...this.flujos].map((f) => f.clientId))]
  }

  arrancar(puerto: number, abrirALaRed = false): Promise<number> {
    if (this.server) return Promise.resolve(puerto)
    return new Promise((cumplir, fallar) => {
      const server = createServer((req, res) => void this.atender(req, res))
      server.on('error', (err) => {
        this.server = null
        fallar(err)
      })
      server.listen(puerto, abrirALaRed ? '0.0.0.0' : '127.0.0.1', () => {
        this.server = server
        this.desuscribir = this.deps.bus.subscribe((ev) => {
          if (!eventoRemoto(ev.channel)) return
          this.repartir(ev)
        })
        cumplir((server.address() as { port: number }).port)
      })
    })
  }

  async detener(): Promise<void> {
    this.desuscribir?.()
    this.desuscribir = null
    for (const f of [...this.flujos]) this.cerrarFlujo(f)
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((cumplir) => server.close(() => cumplir()))
  }

  // ---------- reparto de eventos ----------

  private repartir(ev: { seq: number; channel: string; payload: unknown }): void {
    const linea = JSON.stringify({ tipo: 'evento', ...ev }) + '\n'
    for (const f of [...this.flujos]) {
      if (f.res.writableLength > ATASCO_MAX) {
        this.cerrarFlujo(f)
        continue
      }
      try {
        f.res.write(linea)
      } catch {
        this.cerrarFlujo(f)
      }
    }
  }

  private cerrarFlujo(f: Flujo): void {
    clearInterval(f.latido)
    this.flujos.delete(f)
    try {
      f.res.end()
    } catch {
      /* ya cerrado */
    }
    // Soltar el control solo cuando al dispositivo no le queda ninguna conexión:
    // recargar la página abre la nueva antes de morir la vieja.
    if (!this.conectados.includes(f.clientId)) this.deps.ownership.unregister(f.clientId)
  }

  // ---------- peticiones ----------

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://deck')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')

    try {
      if (url.pathname === '/api/deck') return this.json(res, 200, { deck: true })
      if (url.pathname === '/api/emparejar') return await this.emparejar(req, res)
      if (url.pathname === '/api/accion') return await this.accion(req, res)
      if (url.pathname === '/api/eventos') return this.eventos(req, res, url)
      if (req.method !== 'GET') return this.json(res, 405, { error: 'Método no admitido' })
      return this.estatico(url.pathname, res)
    } catch (err) {
      console.error('gateway:', err)
      if (!res.headersSent) this.json(res, 500, { error: 'Error interno' })
      else res.end()
    }
  }

  private async emparejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return this.json(res, 405, { error: 'Método no admitido' })
    const cuerpo = await this.cuerpo(req)
    if (cuerpo === null) return this.json(res, 413, { error: 'Petición demasiado grande' })
    const { codigo, nombre } = (cuerpo ?? {}) as { codigo?: string; nombre?: string }
    const r = this.deps.auth.emparejar(String(codigo ?? ''), String(nombre ?? ''))
    if (!r.ok) return this.json(res, 401, { error: r.error })
    return this.json(res, 200, { token: r.token, clientId: r.device!.clientId })
  }

  private async accion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return this.json(res, 405, { error: 'Método no admitido' })
    const device = this.deps.auth.verificar(this.token(req))
    if (!device) return this.json(res, 401, { error: 'No autorizado' })

    const cuerpo = await this.cuerpo(req)
    if (cuerpo === null) return this.json(res, 413, { error: 'Petición demasiado grande' })
    const { canal, args } = (cuerpo ?? {}) as { canal?: string; args?: unknown }
    const r = await this.deps.dispatcher.atender(String(canal ?? ''), args, device.clientId)
    return this.json(res, 200, r)
  }

  /**
   * Canal de eventos. `desde` permite recuperar lo perdido en un corte breve; si
   * el anillo ya no lo tiene, se avisa con `hueco` y el cliente se rehidrata
   * pidiendo los snapshots en vez de quedarse con un hueco silencioso.
   */
  private eventos(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (req.method !== 'GET') return this.json(res, 405, { error: 'Método no admitido' })
    const device = this.deps.auth.verificar(this.token(req))
    if (!device) return this.json(res, 401, { error: 'No autorizado' })

    const desde = Number(url.searchParams.get('desde') ?? '0') || 0
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })

    const hueco = this.deps.bus.hasGapSince(desde)
    res.write(
      JSON.stringify({ tipo: 'hola', seq: this.deps.bus.lastSeq, hueco, clientId: device.clientId }) +
        '\n'
    )
    if (!hueco && desde > 0) {
      for (const ev of this.deps.bus.since(desde)) {
        if (eventoRemoto(ev.channel)) res.write(JSON.stringify({ tipo: 'evento', ...ev }) + '\n')
      }
    }

    const flujo: Flujo = {
      clientId: device.clientId,
      res,
      // El túnel corta las conexiones calladas: el latido las mantiene y le dice
      // al móvil que el PC sigue ahí.
      latido: setInterval(() => {
        try {
          res.write(JSON.stringify({ tipo: 'latido' }) + '\n')
        } catch {
          this.cerrarFlujo(flujo)
        }
      }, LATIDO_MS)
    }
    this.flujos.add(flujo)
    this.deps.ownership.register(device.clientId, device.nombre)
    req.on('close', () => this.cerrarFlujo(flujo))
  }

  // ---------- cliente web ----------

  private estatico(pathname: string, res: ServerResponse): void {
    const raiz = resolve(this.deps.webDir)
    // La ruta se normaliza y se comprueba contra la raíz: sin esto, un
    // `/../../deck-state.json` serviría el estado entero de la app.
    const pedido = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^[\\/]+/, '')
    const archivo = resolve(join(raiz, pedido))
    if (archivo !== raiz && !archivo.startsWith(raiz + sep)) {
      return this.json(res, 403, { error: 'Prohibido' })
    }

    // El cliente es una sola página: cualquier ruta desconocida la resuelve él.
    const destino =
      existsSync(archivo) && statSync(archivo).isFile() ? archivo : join(raiz, 'index.html')
    if (!existsSync(destino)) {
      return this.json(res, 503, { error: 'El cliente web no está compilado' })
    }

    const tipo = TIPOS[extname(destino).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': tipo,
      // El HTML nunca se cachea (si no, una versión vieja del cliente se queda
      // pegada); los assets llevan hash en el nombre y sí.
      'Cache-Control': destino.endsWith('index.html') ? 'no-store' : 'public, max-age=604800',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
    })
    createReadStream(destino).pipe(res)
  }

  // ---------- utilidades ----------

  private token(req: IncomingMessage): string | undefined {
    const h = req.headers.authorization
    if (!h || !h.startsWith('Bearer ')) return undefined
    return h.slice(7).trim() || undefined
  }

  /** Cuerpo JSON, o null si se pasó del tope. */
  private cuerpo(req: IncomingMessage): Promise<unknown | null> {
    return new Promise((cumplir) => {
      let datos = ''
      let abortado = false
      req.on('data', (c: Buffer) => {
        if (abortado) return
        datos += c.toString('utf8')
        if (datos.length > CUERPO_MAX) {
          abortado = true
          cumplir(null)
        }
      })
      req.on('end', () => {
        if (abortado) return
        try {
          cumplir(datos ? JSON.parse(datos) : {})
        } catch {
          cumplir({})
        }
      })
      req.on('error', () => !abortado && cumplir({}))
    })
  }

  private json(res: ServerResponse, codigo: number, cuerpo: unknown): void {
    const texto = JSON.stringify(cuerpo)
    res.writeHead(codigo, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(texto)
    })
    res.end(texto)
  }
}
