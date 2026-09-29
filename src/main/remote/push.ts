import webpush from 'web-push'

/**
 * Avisos al móvil con la app cerrada.
 *
 * El canal de eventos solo sirve mientras el navegador está abierto: en cuanto
 * el móvil se bloquea, no hay nadie escuchando. Web Push va por el servicio del
 * fabricante (FCM/Apple), así que llega aunque el túnel esté caído — y llega
 * cifrado de punta a punta con las claves del dispositivo: el intermediario
 * transporta, no lee.
 *
 * Solo tiene sentido con dirección estable: la suscripción pertenece a un
 * origen, y con túnel rápido el origen cambia en cada arranque.
 */

export interface SuscripcionPush {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface ClavesVapid {
  publicKey: string
  privateKey: string
}

export interface PushStore {
  readonly pushKeys: ClavesVapid | undefined
  setPushKeys(k: ClavesVapid): void
  readonly pushSubs: Record<string, SuscripcionPush>
  setPushSubs(s: Record<string, SuscripcionPush>): void
}

export interface Aviso {
  titulo: string
  cuerpo: string
  /** Conversación a la que llevar al pulsar la notificación. */
  tabId?: string
}

/** Respuesta mínima del servicio de push que nos importa. */
export interface RespuestaPush {
  statusCode: number
}

export type EnviarPush = (
  sub: SuscripcionPush,
  payload: string,
  claves: ClavesVapid
) => Promise<RespuestaPush>

const SUJETO = 'https://github.com/jaldana18/claude-deck'

const enviarReal: EnviarPush = async (sub, payload, claves) => {
  const r = await webpush.sendNotification(sub, payload, {
    vapidDetails: { subject: SUJETO, publicKey: claves.publicKey, privateKey: claves.privateKey }
  })
  return { statusCode: r.statusCode }
}

export class Push {
  constructor(
    private store: PushStore,
    private enviar: EnviarPush = enviarReal,
    private generar: () => ClavesVapid = () => webpush.generateVAPIDKeys()
  ) {}

  /**
   * Clave pública que el navegador necesita para suscribirse. El par se genera
   * la primera vez y se guarda: si cambiara, todas las suscripciones vivas
   * quedarían huérfanas.
   */
  clavePublica(): string {
    return this.claves().publicKey
  }

  private claves(): ClavesVapid {
    const guardadas = this.store.pushKeys
    if (guardadas?.publicKey && guardadas.privateKey) return guardadas
    const nuevas = this.generar()
    this.store.setPushKeys(nuevas)
    return nuevas
  }

  suscribir(clientId: string, sub: SuscripcionPush): void {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return
    this.store.setPushSubs({ ...this.store.pushSubs, [clientId]: sub })
  }

  olvidar(clientId: string): void {
    const subs = { ...this.store.pushSubs }
    if (!(clientId in subs)) return
    delete subs[clientId]
    this.store.setPushSubs(subs)
  }

  suscritos(): string[] {
    return Object.keys(this.store.pushSubs)
  }

  /**
   * Avisa a los dispositivos indicados. Un endpoint caducado se borra: el
   * servicio devuelve 404 o 410 cuando el navegador ya tiró la suscripción, y
   * seguir intentándolo solo acumula basura.
   */
  async avisar(clientIds: string[], aviso: Aviso): Promise<number> {
    const subs = this.store.pushSubs
    const claves = this.claves()
    const payload = JSON.stringify(aviso)
    let enviados = 0
    for (const clientId of clientIds) {
      const sub = subs[clientId]
      if (!sub) continue
      try {
        const r = await this.enviar(sub, payload, claves)
        if (r.statusCode === 404 || r.statusCode === 410) this.olvidar(clientId)
        else enviados++
      } catch (err) {
        const codigo = (err as { statusCode?: number }).statusCode
        if (codigo === 404 || codigo === 410) this.olvidar(clientId)
        else console.error('push:', err)
      }
    }
    return enviados
  }
}
