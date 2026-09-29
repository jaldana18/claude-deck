import * as api from './api'
import { boton, el } from './dom'
import { TEMA_CONEXION, tienda } from './estado'
import { hayCodigo, invitacion } from './invitacion'
import {
  actualizarCliente,
  arranque,
  arrancarSesion,
  conectarNotificaciones,
  pararSesion,
  reintentarAhora
} from './sesion'
import { arrancarRuteo, ir, pintar } from './vistas'

const raiz = document.getElementById('app')
if (!raiz) throw new Error('Falta el contenedor de la app')

// El código de invitación se lee una vez y se borra de la barra para que no
// quede a la vista ni en el historial. Si este dispositivo ya está vinculado no
// se usa: ver `invitacion`.
if (hayCodigo(location.hash)) {
  arranque.codigo = invitacion(location.hash, api.sesion() !== null)
  history.replaceState(null, '', location.pathname + location.search)
}

const banda = el('div', 'banda', 'Sin conexión con el PC · reintentando…')
banda.hidden = true

// Igual que en el escritorio: si el PC ya tiene una versión nueva, se avisa y se
// recarga a mano. Nunca sola: recargar sin avisar borraría lo que se esté
// escribiendo.
const bandaVersion = el('div', 'banda nueva')
bandaVersion.append(
  el('span', '', 'Hay una versión nueva'),
  boton('Actualizar', 'chip', () => void actualizarCliente())
)
bandaVersion.hidden = true

const contenedor = el('div', 'vista')
raiz.append(banda, bandaVersion, contenedor)

tienda.escuchar((temas) => {
  if (!temas.has(TEMA_CONEXION)) return
  banda.hidden = tienda.conectado || !api.sesion()
  bandaVersion.hidden = !tienda.versionNueva
})

api.cuandoExpire(() => {
  pararSesion()
  banda.hidden = true
  pintar(true)
})

conectarNotificaciones()
if (api.sesion()) arrancarSesion()
arrancarRuteo(contenedor)

// Al volver del segundo plano el móvil ha congelado los temporizadores: se
// reintenta en el acto en vez de esperar a que toque la siguiente espera.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || tienda.conectado || !api.sesion()) return
  reintentarAhora()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
    const dato = ev.data as { tipo?: string; ruta?: string } | null
    if (dato?.tipo === 'ir' && typeof dato.ruta === 'string') ir(dato.ruta)
  })
}
