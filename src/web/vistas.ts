import * as api from './api'
import { vistaCarpetas } from './vistaCarpetas'
import { vistaChat } from './vistaChat'
import { vistaEmparejar } from './vistaEmparejar'
import { vistaSesiones, vistaTranscripcion } from './vistaHistorial'
import { vistaPanel } from './vistaPanel'

export interface Vista {
  nodo: HTMLElement
  destruir?: () => void
}

const PREFIJO_CHAT = '#/chat/'
const PREFIJO_HISTORIAL = '#/historial/'

let contenedor: HTMLElement | null = null
let actual: Vista | null = null
let firmaActual = ''

export function ir(hash: string): void {
  if (location.hash === hash) {
    pintar(true)
    return
  }
  location.hash = hash
}

export function arrancarRuteo(donde: HTMLElement): void {
  contenedor = donde
  window.addEventListener('hashchange', () => pintar())
  pintar()
}

export function pintar(forzar = false): void {
  if (!contenedor) return
  // Sin token no hay ninguna otra pantalla posible, sea cual sea la ruta.
  const firma = api.sesion() ? location.hash || '#/' : 'emparejar'
  if (!forzar && firma === firmaActual && actual) return
  firmaActual = firma
  actual?.destruir?.()
  actual = construir(firma)
  contenedor.replaceChildren(actual.nodo)
  window.scrollTo(0, 0)
}

function construir(firma: string): Vista {
  if (firma === 'emparejar') return vistaEmparejar()
  if (firma.startsWith(PREFIJO_CHAT)) {
    return vistaChat(decodeURIComponent(firma.slice(PREFIJO_CHAT.length)))
  }
  if (firma === '#/nuevo') return vistaCarpetas('nuevo')
  if (firma === '#/historial') return vistaCarpetas('historial')
  if (firma.startsWith(PREFIJO_HISTORIAL)) {
    const [carpeta, sesion] = firma.slice(PREFIJO_HISTORIAL.length).split('/')
    const cwd = decodeURIComponent(carpeta)
    return sesion ? vistaTranscripcion(cwd, decodeURIComponent(sesion)) : vistaSesiones(cwd)
  }
  return vistaPanel()
}
