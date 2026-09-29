import type { ChatMessage, SessionListItem } from '../shared/types'
import * as api from './api'
import { burbuja } from './burbujas'
import { avisoError, boton, el, fila, recorta } from './dom'
import { carpetaCorta, tienda } from './estado'
import { ir, type Vista } from './vistas'

/**
 * Historial: las conversaciones pasadas de una carpeta y la lectura de una de
 * ellas.
 *
 * Leer no reanuda nada —no arranca ningún proceso en el PC ni toca la sesión—,
 * y continuar una crea una pestaña nueva, que es lo mismo que hace el PC al
 * reanudar desde su buscador.
 */

function cuando(ms: number): string {
  const d = new Date(ms)
  const dias = Math.floor((Date.now() - ms) / 86_400_000)
  if (dias === 0) return `hoy ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
  if (dias === 1) return `ayer ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function vistaSesiones(cwd: string): Vista {
  const nodo = el('div', 'pantalla')
  const atras = boton('←', 'icono', () => ir('#/historial'))
  const titulo = el('div', 'titulo-barra', carpetaCorta(cwd))
  const barra = fila('barra', atras, titulo)
  const ruta = el('div', 'ruta-actual', cwd)
  const lista = el('div', 'tarjetas')
  const zonaAviso = el('div', 'zona-aviso')
  nodo.append(barra, fila('cuerpo', ruta, zonaAviso, lista))

  lista.replaceChildren(el('div', 'vacio', 'Buscando conversaciones…'))

  void (async () => {
    try {
      const sesiones = await api.pedirSesiones(cwd)
      lista.replaceChildren(
        ...(sesiones.length
          ? sesiones.map(tarjeta)
          : [el('div', 'vacio', 'No hay conversaciones guardadas en esta carpeta.')])
      )
    } catch (err) {
      lista.replaceChildren()
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo leer el historial', () =>
          ir(`#/historial/${encodeURIComponent(cwd)}`)
        )
      )
    }
  })()

  function tarjeta(s: SessionListItem): HTMLElement {
    const b = el('button', 'tarjeta')
    b.type = 'button'
    b.addEventListener('click', () =>
      ir(`#/historial/${encodeURIComponent(cwd)}/${encodeURIComponent(s.sessionId)}`)
    )
    const cabecera = fila('linea', el('span', 'nombre', recorta(s.summary, 90)))
    cabecera.append(el('span', 'chip', cuando(s.lastModified)))
    b.append(cabecera)
    if (s.firstPrompt && s.firstPrompt !== s.summary) {
      b.append(el('div', 'ruta', recorta(s.firstPrompt, 90)))
    }
    return b
  }

  return { nodo }
}

export function vistaTranscripcion(cwd: string, sessionId: string): Vista {
  const nodo = el('div', 'pantalla chat')
  const atras = boton('←', 'icono', () => ir(`#/historial/${encodeURIComponent(cwd)}`))
  const titulo = el('div', 'titulo-chat')
  titulo.append(el('div', 'nombre', 'Conversación guardada'), el('div', 'ruta', carpetaCorta(cwd)))
  const barra = fila('barra', atras, titulo)

  const hilo = el('div', 'hilo')
  const zonaAviso = el('div', 'zona-aviso')
  const continuar = boton('Continuar en el PC', 'boton principal', () => void reanudar())
  const pie = fila('pie-fijo', continuar)
  nodo.append(barra, hilo, zonaAviso, pie)

  const abiertos = new Set<string>()
  hilo.replaceChildren(el('div', 'vacio', 'Cargando la conversación…'))

  void (async () => {
    try {
      const mensajes = await api.pedirTranscripcion(cwd, sessionId)
      pintar(mensajes)
    } catch (err) {
      hilo.replaceChildren()
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo leer la conversación')
      )
    }
  })()

  function pintar(mensajes: ChatMessage[]): void {
    hilo.replaceChildren(
      ...(mensajes.length
        ? mensajes.map((m) => burbuja(m, abiertos))
        : [el('div', 'vacio', 'Esta conversación no tiene mensajes guardados.')])
    )
  }

  /** Reanudarla crea una pestaña en el PC: de ahí en adelante es una conversación viva. */
  async function reanudar(): Promise<void> {
    continuar.disabled = true
    continuar.textContent = 'Abriendo…'
    try {
      const tab = await api.abrirSesion(cwd, sessionId)
      tienda.anadirPestana(tab)
      ir(`#/chat/${encodeURIComponent(tab.id)}`)
    } catch (err) {
      continuar.disabled = false
      continuar.textContent = 'Continuar en el PC'
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo reanudar')
      )
    }
  }

  return { nodo }
}
