import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { PairingInfo, RemoteSettings, RemoteStatus } from '../../../shared/types'

/**
 * Panel del acceso remoto: enciende el servidor, publica el túnel y empareja el
 * móvil con un QR.
 *
 * Encender esto publica el PC en internet, así que el panel no esconde nada: se
 * ve el estado real del túnel, la dirección, qué carpetas quedan a la vista y
 * qué dispositivos tienen llave, con su botón de revocar al lado.
 */

const FASES: Record<RemoteStatus['tunel'], { texto: string; color: string }> = {
  apagado: { texto: 'Apagado', color: 'var(--cd-text-dim, #888)' },
  arrancando: { texto: 'Abriendo el túnel…', color: '#d9a03c' },
  activo: { texto: 'Publicado', color: '#3fb950' },
  caido: { texto: 'Caído', color: '#e5534b' }
}

function minutos(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m === 1 ? '1 minuto' : `${m} minutos`
}

export function RemotePanel(p: { onClose: () => void }): React.JSX.Element {
  const [estado, setEstado] = useState<RemoteStatus | null>(null)
  const [ajustes, setAjustes] = useState<RemoteSettings | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [qrApp, setQrApp] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [error, setError] = useState('')
  const [raices, setRaices] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)

  const refrescarRaices = useCallback((): void => {
    void window.deck.remoteRaices().then(setRaices)
  }, [])

  useEffect(() => {
    void window.deck.remoteGet().then(setEstado)
    void window.deck.remoteSettings().then(setAjustes)
    refrescarRaices()
    return window.deck.onRemoteStatus((s) => {
      setEstado(s)
      // El túnel quick cambia de dirección al reabrirse y el main abre un
      // emparejamiento nuevo: el QR de la pantalla tiene que seguirle.
      if (s.pairing) setPairing(s.pairing)
    })
  }, [refrescarRaices])

  useEffect(() => {
    if (!pairing) {
      setQr(null)
      return
    }
    void QRCode.toDataURL(pairing.url, {
      width: 232,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(setQr)
  }, [pairing])

  // El QR de la dirección a secas es el de instalar: no lleva código, así que no
  // caduca, no se gasta y vale para cualquier dispositivo.
  useEffect(() => {
    const url = estado?.url
    if (!url) {
      setQrApp(null)
      return
    }
    void QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(setQrApp)
  }, [estado?.url])

  const aplicar = async (patch: Partial<RemoteSettings>): Promise<void> => {
    setOcupado(true)
    setError('')
    try {
      const s = await window.deck.remoteSet(patch)
      setEstado(s)
      setAjustes(await window.deck.remoteSettings())
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setOcupado(false)
    }
  }

  const emparejar = async (): Promise<void> => {
    setError('')
    const r = await window.deck.remotePair()
    if (r.error) {
      setError(r.error)
      return
    }
    setPairing(r.pairing ?? null)
  }

  if (!estado || !ajustes) return <div className="cd-overlay" />

  const fase = FASES[estado.tunel]
  const conectados = new Set(estado.conectados)

  return (
    <div
      className="cd-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}
    >
      <div className="cd-dialog" style={{ maxWidth: 620 }}>
        <div className="cd-dialog__head">
          <span className="cd-dialog__icon">📱</span>
          <span className="cd-dialog__title">Acceso remoto</span>
          <button className="cd-dialog__close" onClick={p.onClose} title="Cerrar">
            ×
          </button>
        </div>

        <div className="cd-dialog__body">
          <p className="cd-help">
            Publica este PC para poder trabajar en él desde el móvil. La ejecución sigue pasando
            aquí: el móvil solo ve las conversaciones y manda instrucciones. El terminal, los
            plugins y la configuración <b>no</b> se exponen.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '14px 0',
              padding: '10px 12px',
              border: '1px solid var(--cd-border, #333)',
              borderRadius: 8
            }}
          >
            <button
              className="cd-chip"
              aria-pressed={estado.enabled}
              disabled={ocupado}
              onClick={() => void aplicar({ enabled: !estado.enabled })}
            >
              {estado.enabled ? 'Apagar' : 'Encender'}
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ color: fase.color, fontWeight: 600 }}>{fase.texto}</div>
              <div className="cd-help" style={{ margin: 0 }}>
                {estado.url ?? (estado.enabled ? 'Sin dirección todavía' : 'No está publicado')}
                {estado.detalle ? ` — ${estado.detalle}` : ''}
              </div>
            </div>
          </div>

          {estado.alerta && (
            <p
              className="cd-help"
              style={{ color: '#d9a03c', border: '1px solid #d9a03c55', borderRadius: 6, padding: 8 }}
            >
              {estado.alerta}
            </p>
          )}
          {estado.bloqueadoHasta && (
            <p className="cd-help" style={{ color: '#e5534b' }}>
              Autenticación cerrada por intentos fallidos durante{' '}
              {minutos(estado.bloqueadoHasta - Date.now())}.
            </p>
          )}
          {error && (
            <p className="cd-help" style={{ color: '#e5534b' }}>
              {error}
            </p>
          )}

          <hr className="cd-sep" />

          <label className="cd-label">Cómo sale a internet</label>
          <div className="cd-chiprow">
            {(
              [
                ['quick', 'Túnel rápido', 'sin configurar nada; dirección nueva en cada arranque'],
                ['dominio', 'Dominio propio', 'dirección estable; se configura una vez'],
                ['ninguno', 'Solo red local', 'misma wifi, sin salir a internet']
              ] as const
            ).map(([valor, texto, pista]) => (
              <button
                key={valor}
                type="button"
                className="cd-chip"
                aria-pressed={ajustes.tunel === valor}
                title={pista}
                disabled={ocupado}
                onClick={() => void aplicar({ tunel: valor })}
              >
                {texto}
              </button>
            ))}
          </div>

          {ajustes.tunel === 'quick' && (
            <p className="cd-help">
              Cloudflare da una dirección temporal. Es lo más rápido para probar, pero al reiniciar
              el PC o caerse el túnel la dirección es otra, y para el móvil eso es un sitio nuevo:
              hay que volver a escanear el QR y la app instalada se reinstala.
            </p>
          )}

          {ajustes.tunel === 'dominio' && (
            <>
              <div className="params-row two" style={{ marginTop: 10 }}>
                <div>
                  <label className="cd-label">Nombre público</label>
                  <input
                    className="cd-input"
                    placeholder="deck.midominio.com"
                    defaultValue={ajustes.hostname ?? ''}
                    onBlur={(e) => void aplicar({ hostname: e.target.value.trim() })}
                  />
                </div>
                <div>
                  <label className="cd-label">Token del túnel</label>
                  <input
                    className="cd-input"
                    type="password"
                    placeholder="eyJhIjoi…"
                    defaultValue={ajustes.tunelToken ?? ''}
                    onBlur={(e) => void aplicar({ tunelToken: e.target.value.trim() })}
                  />
                </div>
              </div>
              <ol className="cd-help" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                <li>
                  Entra en <b>Cloudflare Zero Trust → Networks → Tunnels</b> y crea un túnel de tipo
                  <b> Cloudflared</b>.
                </li>
                <li>
                  Copia el <b>token</b> que aparece en el comando de instalación (la cadena larga
                  que empieza por <code>eyJ…</code>) y pégalo arriba.
                </li>
                <li>
                  En <b>Public Hostname</b> añade tu subdominio, tipo de servicio <b>HTTP</b> y URL{' '}
                  <code>127.0.0.1:{ajustes.puerto}</code>.
                </li>
                <li>Escribe ese mismo subdominio en «Nombre público» y enciende el acceso.</li>
              </ol>
              <p className="cd-help">
                Con dominio propio la dirección no cambia: la app del móvil se instala una vez y el
                emparejamiento sobrevive a los reinicios.
              </p>
            </>
          )}

          <hr className="cd-sep" />

          <label className="cd-label">Añadir un dispositivo</label>
          <p className="cd-help">
            Dos pasos y en este orden: primero se instala la app en el móvil, y desde la app
            instalada se vincula con el código. Al revés funciona en Android, pero en iPhone la app
            añadida a la pantalla de inicio guarda sus datos aparte del navegador y volvería a
            pedir el código.
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>1 · Instalar la app</div>
              {qrApp ? (
                <>
                  <div style={{ background: '#fff', padding: 8, width: 'fit-content', borderRadius: 8 }}>
                    <img src={qrApp} alt="QR de la dirección para instalar la app" width={200} height={200} />
                  </div>
                  <p className="cd-help">
                    Escanea, abre la dirección y elige «Añadir a pantalla de inicio». Este QR no
                    lleva código: no caduca y sirve para todos los dispositivos.
                  </p>
                </>
              ) : (
                <p className="cd-help">Enciende el acceso remoto para tener una dirección.</p>
              )}
            </div>

            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>2 · Vincular con el código</div>
              {pairing ? (
                <>
                  <div
                    style={{
                      fontFamily: 'var(--cd-mono, monospace)',
                      fontSize: 30,
                      letterSpacing: 4,
                      lineHeight: 1.1
                    }}
                  >
                    {pairing.codigo.slice(0, 4)} {pairing.codigo.slice(4)}
                  </div>
                  <div className="cd-help" style={{ margin: '2px 0 8px' }}>
                    vale una sola vez · caduca en {minutos(pairing.expira - Date.now())}
                  </div>
                  {qr && (
                    <div style={{ background: '#fff', padding: 8, width: 'fit-content', borderRadius: 8 }}>
                      <img src={qr} alt="QR de vinculación" width={200} height={200} />
                    </div>
                  )}
                  <p className="cd-help">
                    Teclea el código en la app que acabas de instalar. Escanear este QR también
                    vincula, pero abre el navegador, y esa vinculación no siempre vale dentro de la
                    app instalada.
                  </p>
                  <button className="cd-chip" onClick={() => void emparejar()}>
                    Otro código
                  </button>
                </>
              ) : (
                <>
                  <button className="cd-chip" disabled={!estado.enabled} onClick={() => void emparejar()}>
                    Generar código
                  </button>
                  <p className="cd-help">Lo teclearás en el móvil, dentro de la app instalada.</p>
                </>
              )}
            </div>
          </div>

          <hr className="cd-sep" />

          <label className="cd-label">Dispositivos con llave</label>
          {estado.dispositivos.length === 0 ? (
            <p className="cd-help">Ninguno todavía.</p>
          ) : (
            <div>
              {estado.dispositivos.map((d) => (
                <div
                  key={d.clientId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--cd-border, #2a2a2a)'
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {d.nombre}
                    {conectados.has(d.clientId) && (
                      <span style={{ color: '#3fb950', marginLeft: 8, fontSize: 12 }}>
                        conectado
                      </span>
                    )}
                  </span>
                  <button
                    className="cd-chip"
                    onClick={() => void window.deck.remoteRevoke(d.clientId).then(setEstado)}
                  >
                    Revocar
                  </button>
                </div>
              ))}
              <button
                className="cd-chip"
                style={{ marginTop: 10 }}
                onClick={() => void window.deck.remoteRevokeAll().then(setEstado)}
              >
                Revocar todos
              </button>
            </div>
          )}

          <hr className="cd-sep" />

          <label className="cd-label">Carpetas visibles desde fuera</label>
          <p className="cd-help">
            El móvil solo puede listar y abrir chats dentro de estas carpetas. Sin nada configurado
            son las de las pestañas abiertas y su carpeta madre, para poder elegir un proyecto
            hermano.
          </p>
          <div style={{ fontFamily: 'var(--cd-mono, monospace)', fontSize: 12, lineHeight: 1.8 }}>
            {raices.map((r) => (
              <div key={r} style={{ display: 'flex', gap: 8 }}>
                <span style={{ flex: 1 }}>{r}</span>
                {ajustes.raices?.includes(r) && (
                  <button
                    className="cd-chip"
                    onClick={() =>
                      void aplicar({ raices: (ajustes.raices ?? []).filter((x) => x !== r) }).then(
                        refrescarRaices
                      )
                    }
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="cd-chip"
            style={{ marginTop: 10 }}
            onClick={() =>
              void window.deck.pickFolder().then((carpeta) => {
                if (!carpeta) return
                void aplicar({ raices: [...new Set([...(ajustes.raices ?? raices), carpeta]) ] }).then(
                  refrescarRaices
                )
              })
            }
          >
            Añadir carpeta
          </button>

          <hr className="cd-sep" />

          <label className="cd-label">Apagado automático</label>
          <p className="cd-help">
            Minutos sin ningún dispositivo conectado tras los que el acceso se apaga solo. Vacío o 0
            = no se apaga nunca.
          </p>
          <input
            className="cd-input"
            type="number"
            min={0}
            step={30}
            defaultValue={ajustes.apagarTrasMin ?? 0}
            onBlur={(e) =>
              void aplicar({ apagarTrasMin: Math.max(0, parseInt(e.target.value, 10) || 0) })
            }
          />
        </div>
      </div>
    </div>
  )
}
