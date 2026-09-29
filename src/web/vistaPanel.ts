import { boton, el, fila, recorta } from './dom'
import {
  atencionPendiente,
  carpetaCorta,
  pctContexto,
  TEMA_CONEXION,
  TEMA_TABS,
  tienda,
  trabajando,
  type EntradaTab
} from './estado'
import { ir, type Vista } from './vistas'

/** Panel de actividad: todas las conversaciones y qué está esperando a quién. */
export function vistaPanel(): Vista {
  const nodo = el('div', 'pantalla')
  const titulo = el('div', 'titulo-barra', 'Conversaciones')
  const nuevo = boton('+ Nuevo chat', 'chip accion', () => ir('#/nuevo'))
  const barra = fila('barra', titulo, nuevo)

  const tarjetas = el('div', 'tarjetas')
  const pie = el('p', 'pista')
  const cuerpo = fila('cuerpo', tarjetas, pie)
  nodo.append(barra, cuerpo)

  function pintarLista(): void {
    const entradas = tienda.conversaciones()
    const pendientes = entradas.filter((e) => atencionPendiente(e) > 0)
    const resto = entradas.filter((e) => atencionPendiente(e) === 0)

    const hijos: HTMLElement[] = []
    if (!entradas.length) {
      hijos.push(
        el('div', 'vacio', tienda.conectado ? 'No hay conversaciones abiertas en el PC.' : 'Sin datos del PC.')
      )
    }
    // Lo que espera respuesta va primero: es lo único que no puede esperar.
    for (const e of [...pendientes, ...resto]) hijos.push(tarjeta(e))
    tarjetas.replaceChildren(...hijos)

    const terminales = tienda.terminales()
    pie.textContent = terminales
      ? `${terminales} ${terminales === 1 ? 'pestaña' : 'pestañas'} de terminal: esas solo se usan desde el PC.`
      : ''
  }

  const dejarDeEscuchar = tienda.escuchar((temas) => {
    if (temas.has(TEMA_TABS) || temas.has(TEMA_CONEXION)) pintarLista()
  })
  pintarLista()

  return { nodo, destruir: dejarDeEscuchar }
}

function tarjeta(e: EntradaTab): HTMLElement {
  const espera = atencionPendiente(e)
  const b = el('button', espera ? 'tarjeta atiende' : 'tarjeta')
  b.type = 'button'
  b.addEventListener('click', () => ir(`#/chat/${encodeURIComponent(e.tab.id)}`))

  const nombre = el('span', 'nombre', e.tab.title || carpetaCorta(e.tab.cwd))
  const cabecera = fila('linea', nombre)
  if (trabajando(e)) cabecera.append(el('span', 'chip trabajando', 'Trabajando'))
  b.append(cabecera, el('div', 'ruta', carpetaCorta(e.tab.cwd)))

  if (espera) {
    const pendiente = e.snapshot?.permissions[0]
    const pregunta = e.snapshot?.questions[0]
    const texto = pendiente
      ? `Permiso: ${pendiente.title ?? pendiente.toolName}`
      : `Pregunta: ${pregunta?.questions[0]?.question ?? 'hay algo que decidir'}`
    b.append(el('div', 'atiende-linea', recorta(texto, 90)))
  }

  const chips = el('div', 'chips')
  const salud = e.snapshot?.health
  if (salud && salud.contextWindow) chips.append(el('span', 'chip', `Contexto ${pctContexto(salud)}%`))
  if (salud && salud.costUsd > 0) {
    chips.append(el('span', 'chip', `${salud.costUsd.toFixed(2)} $`))
  }
  if (e.owner && e.owner.connected) {
    const mio = e.owner.clientId === tienda.miClientId
    chips.append(el('span', mio ? 'chip mio' : 'chip ajeno', mio ? 'Lo controlas tú' : `Controla ${e.owner.label}`))
  }
  if (e.aviso) chips.append(el('span', 'chip', e.aviso))
  if (e.error) chips.append(el('span', 'chip error', recorta(e.error, 60)))
  if (chips.childElementCount) b.append(chips)

  return b
}
