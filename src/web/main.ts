import * as api from './api'
import { el } from './dom'
import { TEMA_CONEXION, tienda } from './estado'
import { arranque, arrancarSesion, conectarNotificaciones, pararSesion, reintentarAhora } from './sesion'
import { arrancarRuteo, ir, pintar } from './vistas'

const raiz = document.getElementById('app')
if (!raiz) throw new Error('Falta el contenedor de la app')

// El código de invitación viaja en el fragmento de la URL: el navegador no lo
// manda al servidor, así que no aparece en ningún registro ni en el túnel. Se
// lee una vez y se borra de la barra para que no quede a la vista ni en el
// historial del navegador.
const traeCodigo = /(?:^#|[#&?])c=([A-Za-z0-9]{4,16})/.exec(location.hash)
if (traeCodigo) {
  arranque.codigo = traeCodigo[1].toUpperCase()
  history.replaceState(null, '', location.pathname + location.search)
}

const banda = el('div', 'banda', 'Sin conexión con el PC · reintentando…')
banda.hidden = true
const contenedor = el('div', 'vista')
raiz.append(banda, contenedor)

tienda.escuchar((temas) => {
  if (!temas.has(TEMA_CONEXION)) return
  banda.hidden = tienda.conectado || !api.sesion()
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
