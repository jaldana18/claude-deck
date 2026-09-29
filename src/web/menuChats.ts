import { boton, el, fila } from './dom'
import {
  atencionPendiente,
  carpetaCorta,
  TEMA_TABS,
  tienda,
  trabajando,
  type EntradaTab
} from './estado'
import { ir } from './vistas'

/**
 * Menú de conversaciones: cambiar de chat sin pasar por el panel.
 *
 * Se abre sobre lo que haya y se cierra al elegir o al tocar fuera. No toca el
 * historial del navegador: el botón «atrás» del móvil tiene que seguir
 * significando lo mismo que antes de abrirlo.
 */
export function abrirMenuChats(actual?: string): void {
  const capa = el('div', 'capa-menu')
  const hoja = el('div', 'hoja-menu')
  const lista = el('div', 'hoja-lista')

  const cerrar = (): void => {
    dejarDeEscuchar()
    capa.remove()
  }

  capa.addEventListener('click', (ev) => {
    if (ev.target === capa) cerrar()
  })

  function pintar(): void {
    const entradas = tienda.conversaciones()
    lista.replaceChildren(
      ...(entradas.length
        ? entradas.map(item)
        : [el('div', 'vacio', 'No hay conversaciones abiertas en el PC.')])
    )
  }

  function item(e: EntradaTab): HTMLElement {
    const b = el('button', e.tab.id === actual ? 'hoja-item actual' : 'hoja-item')
    b.type = 'button'
    const linea = fila('linea', el('span', 'nombre', e.tab.title || carpetaCorta(e.tab.cwd)))
    if (atencionPendiente(e)) linea.append(el('span', 'chip atiende', 'Te espera'))
    else if (trabajando(e)) linea.append(el('span', 'chip trabajando', 'Trabajando'))
    b.append(linea, el('div', 'ruta', carpetaCorta(e.tab.cwd)))
    b.addEventListener('click', () => {
      cerrar()
      ir(`#/chat/${encodeURIComponent(e.tab.id)}`)
    })
    return b
  }

  const cabecera = fila(
    'hoja-cab',
    el('div', 'titulo-barra', 'Conversaciones'),
    boton('✕', 'icono', cerrar)
  )
  const pie = fila(
    'hoja-pie',
    boton('+ Nuevo chat', 'chip accion', () => {
      cerrar()
      ir('#/nuevo')
    }),
    boton('Historial', 'chip', () => {
      cerrar()
      ir('#/historial')
    }),
    boton('Panel', 'chip', () => {
      cerrar()
      ir('#/')
    })
  )

  // Mientras está abierto sigue vivo: un permiso que llega tiene que verse aquí
  // también, que es donde se está mirando.
  const dejarDeEscuchar = tienda.escuchar((temas) => {
    if (temas.has(TEMA_TABS)) pintar()
  })

  pintar()
  hoja.append(cabecera, lista, pie)
  capa.append(hoja)
  document.body.append(capa)
}
