import type { ChatMessage, PermissionRequestEvent, QuestionRequestEvent } from '../shared/types'
import * as api from './api'
import { burbuja, firmaMensaje } from './burbujas'
import { avisoError, boton, el, fila, recorta } from './dom'
import { carpetaCorta, pctContexto, TEMA_CONEXION, TEMA_TABS, temaChat, tienda } from './estado'
import { abrirMenuChats } from './menuChats'
import { ir, type Vista } from './vistas'

const CLAVE_BORRADOR = 'deck.borrador.'

/** Una conversación: historial, estado vivo, permisos, preguntas y compositor. */
export function vistaChat(tabId: string): Vista {
  const nodo = el('div', 'pantalla chat')

  const atras = boton('←', 'icono', () => ir('#/'))
  const menu = boton('☰', 'icono', () => abrirMenuChats(tabId))
  menu.title = 'Cambiar de conversación'
  menu.setAttribute('aria-label', 'Cambiar de conversación')
  const titulo = el('div', 'titulo-chat')
  const nombre = el('div', 'nombre')
  const ruta = el('div', 'ruta')
  titulo.append(nombre, ruta)
  const selModelo = el('select', 'selector')
  selModelo.setAttribute('aria-label', 'Modelo')
  selModelo.addEventListener('change', () => void cambiarModelo(selModelo.value))
  const detener = boton('Detener', 'chip peligro', () => void detenerTurno())
  const barra = fila('barra', atras, menu, titulo, selModelo, detener)

  const bandaDueno = el('div', 'banda-dueno')
  const hilo = el('div', 'hilo')
  const cargador = el('div', 'vacio', 'Cargando la conversación…')
  const zonaAviso = el('div', 'zona-aviso')
  const pendientes = el('div', 'pendientes')
  const burbujaStream = el('div', 'burbuja assistant escribiendo')
  const textoStream = el('div', 'parrafo')
  burbujaStream.append(textoStream)

  const tiraTodos = el('details', 'todos')
  const resumenTodos = el('summary', '')
  const listaTodos = el('ul', 'todos-lista')
  tiraTodos.append(resumenTodos, listaTodos)

  const tiraSalud = el('div', 'salud')
  const campo = el('textarea', 'composer-campo')
  campo.rows = 1
  campo.setAttribute('aria-label', 'Mensaje para Claude')
  const enviar = boton('Enviar', 'boton enviar', () => void mandar())
  const sugerencias = el('div', 'sugerencias')
  const composer = fila('composer', sugerencias, fila('composer-fila', campo, enviar))

  nodo.append(barra, bandaDueno, hilo, tiraTodos, tiraSalud, composer)

  /** Herramientas desplegadas: se conserva al repintar por un resultado nuevo. */
  const abiertos = new Set<string>()
  const pintados = new Map<string, HTMLElement>()
  let firmaHilo = ''
  let firmaPendientes = ''

  // ---------- composer ----------

  campo.value = localStorage.getItem(CLAVE_BORRADOR + tabId) ?? ''
  campo.addEventListener('input', () => {
    // El borrador es de este dispositivo: lo que se sincroniza son las
    // conversaciones, no lo que uno está tecleando.
    localStorage.setItem(CLAVE_BORRADOR + tabId, campo.value)
    ajustarAlto()
    pintarSugerencias()
    pintarComposer()
  })
  function ajustarAlto(): void {
    campo.style.height = 'auto'
    campo.style.height = `${Math.min(campo.scrollHeight, Math.round(window.innerHeight * 0.35))}px`
  }

  function pintarSugerencias(): void {
    const s = tienda.entrada(tabId)?.snapshot
    const escrito = campo.value
    const m = /^\/([\w:-]*)$/.exec(escrito)
    if (!m || !s?.commands.length) {
      sugerencias.replaceChildren()
      return
    }
    const filtro = m[1].toLowerCase()
    const candidatos = s.commands.filter((c) => c.name.toLowerCase().startsWith(filtro)).slice(0, 6)
    sugerencias.replaceChildren(
      ...candidatos.map((c) =>
        boton(`/${c.name}`, 'chip', () => {
          campo.value = `/${c.name} `
          localStorage.setItem(CLAVE_BORRADOR + tabId, campo.value)
          sugerencias.replaceChildren()
          campo.focus()
        })
      )
    )
  }

  function avisar(texto: string): void {
    zonaAviso.replaceChildren(avisoError(texto))
  }

  function tratarFallo(err: unknown): void {
    if (err instanceof api.ErrorAccion && err.motivo === 'sin-control') {
      // Nos quitaron el control mientras escribíamos: se refresca el indicador.
      void tienda.refrescarDuenos()
      avisar('El control lo tiene otro dispositivo. Tómalo para seguir.')
      return
    }
    if (err instanceof api.TokenMuerto) return
    avisar(err instanceof Error ? err.message : 'No se pudo hacer')
  }

  async function mandar(): Promise<void> {
    const texto = campo.value.trim()
    if (!texto) return
    enviar.disabled = true
    zonaAviso.replaceChildren()
    try {
      await api.enviar(tabId, texto)
      campo.value = ''
      localStorage.removeItem(CLAVE_BORRADOR + tabId)
      ajustarAlto()
      sugerencias.replaceChildren()
      // No se pinta la burbuja del usuario: el eco lo manda el PC y es lo que
      // garantiza que los dos dispositivos vean lo mismo.
    } catch (err) {
      tratarFallo(err)
    } finally {
      pintarComposer()
    }
  }

  async function detenerTurno(): Promise<void> {
    try {
      await api.interrumpir(tabId)
    } catch (err) {
      tratarFallo(err)
    }
  }

  async function tomarControl(): Promise<void> {
    try {
      tienda.ponerDueno(await api.reclamar(tabId))
      zonaAviso.replaceChildren()
    } catch (err) {
      tratarFallo(err)
    }
  }

  async function cambiarModelo(model: string): Promise<void> {
    try {
      await api.ponerModelo(tabId, model)
    } catch (err) {
      tratarFallo(err)
    }
  }

  // ---------- pintado ----------

  function pintarCabecera(): void {
    const e = tienda.entrada(tabId)
    nombre.textContent = e?.tab.title ?? 'Conversación'
    ruta.textContent = e ? carpetaCorta(e.tab.cwd) : ''
    const trabajando = Boolean(e?.snapshot?.busy)
    detener.hidden = !trabajando || !tienda.tieneControl(tabId)

    const modelos = e?.snapshot?.models ?? []
    const actual = e?.snapshot?.health.model ?? e?.tab.model ?? ''
    if (!modelos.length) {
      selModelo.hidden = true
    } else {
      selModelo.hidden = false
      const firma = modelos.map((m) => m.value).join('|') + `#${actual}`
      if (selModelo.dataset.firma !== firma) {
        selModelo.dataset.firma = firma
        const porDefecto = el('option', '', 'Modelo por defecto')
        porDefecto.value = ''
        const opciones = [
          porDefecto,
          ...modelos.map((m) => {
            const o = el('option', '', m.displayName || m.value)
            o.value = m.value
            return o
          })
        ]
        if (actual && !modelos.some((m) => m.value === actual)) {
          const o = el('option', '', actual)
          o.value = actual
          opciones.splice(1, 0, o)
        }
        selModelo.replaceChildren(...opciones)
        selModelo.value = actual
      }
    }
  }

  function pintarDueno(): void {
    const e = tienda.entrada(tabId)
    const control = tienda.tieneControl(tabId)
    bandaDueno.hidden = control
    if (control || !e?.owner) return
    bandaDueno.replaceChildren(
      el('span', '', `Controla ${e.owner.label}`),
      boton('Tomar el control', 'chip accion', () => void tomarControl())
    )
  }

  function pintarHilo(): void {
    const c = tienda.chat(tabId)
    const abajo = hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 90

    const firma =
      `${c.cargando ? 1 : 0}${c.cargado ? 1 : 0}|` +
      c.mensajes.map((m) => `${m.id}~${firmaMensaje(m)}`).join('|')
    if (firma !== firmaHilo) {
      firmaHilo = firma
      const hijos: HTMLElement[] = []
      const vivos = new Set<string>()
      for (const m of c.mensajes) {
        vivos.add(m.id)
        const propia = firmaMensaje(m)
        let n = pintados.get(m.id)
        if (!n || n.dataset.firma !== propia) {
          n = burbuja(m, abiertos)
          n.dataset.firma = propia
          pintados.set(m.id, n)
        }
        hijos.push(n)
      }
      for (const id of [...pintados.keys()]) if (!vivos.has(id)) pintados.delete(id)
      if (!hijos.length) hijos.push(c.cargado ? el('div', 'vacio', 'Sin mensajes todavía.') : cargador)
      hilo.replaceChildren(...hijos, burbujaStream, pendientes, zonaAviso)
    }

    if (abajo) hilo.scrollTop = hilo.scrollHeight
  }

  function pintarStream(): void {
    const s = tienda.entrada(tabId)?.snapshot
    const abajo = hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 90
    if (s?.streaming) {
      burbujaStream.hidden = false
      // Texto plano mientras escribe: reinterpretar el markdown en cada delta
      // sería rehacer el mensaje entero muchas veces por segundo.
      textoStream.textContent = s.streaming.text
    } else {
      burbujaStream.hidden = true
      textoStream.textContent = ''
    }
    if (abajo) hilo.scrollTop = hilo.scrollHeight
  }

  function pintarPendientes(): void {
    const s = tienda.entrada(tabId)?.snapshot
    const control = tienda.tieneControl(tabId)
    // Solo se rehacen si cambian de verdad: rehacerlas con cada delta borraría
    // las opciones que el usuario ya tenía marcadas en una pregunta.
    const firma = [
      control ? 'c' : '-',
      ...(s?.permissions ?? []).map((p) => p.requestId),
      ...(s?.questions ?? []).map((q) => q.requestId)
    ].join('|')
    if (firma === firmaPendientes) return
    firmaPendientes = firma
    const abajo = hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 90
    const hijos: HTMLElement[] = []
    for (const p of s?.permissions ?? []) hijos.push(tarjetaPermiso(p, control))
    for (const q of s?.questions ?? []) hijos.push(tarjetaPregunta(q, control))
    pendientes.replaceChildren(...hijos)
    if (abajo) hilo.scrollTop = hilo.scrollHeight
  }

  function tarjetaPermiso(p: PermissionRequestEvent, control: boolean): HTMLElement {
    const caja = el('div', 'tarjeta permiso')
    caja.append(
      el('div', 'etiqueta', 'Permiso'),
      el('div', 'nombre', p.title ?? `Claude quiere usar ${p.toolName}`)
    )
    if (p.description) caja.append(el('div', 'ruta', p.description))
    caja.append(el('pre', 'previa', recorta(p.inputPreview, 1200)))

    const acciones = el('div', 'acciones')
    const responder = (decision: 'allow' | 'always' | 'deny') => {
      for (const b of acciones.querySelectorAll('button')) b.disabled = true
      tienda.quitarPermiso(p.tabId, p.requestId)
      void api.responderPermiso(p.tabId, p.requestId, decision).catch(tratarFallo)
    }
    const permitir = boton('Permitir', 'boton si', () => responder('allow'))
    const siempre = boton('Permitir siempre', 'boton', () => responder('always'))
    const denegar = boton('Denegar', 'boton no', () => responder('deny'))
    acciones.append(permitir)
    if (p.canAlwaysAllow) acciones.append(siempre)
    acciones.append(denegar)
    for (const b of [permitir, siempre, denegar]) b.disabled = !control
    caja.append(acciones)
    if (!control) caja.append(el('div', 'pista', 'Toma el control para decidir.'))
    return caja
  }

  function tarjetaPregunta(q: QuestionRequestEvent, control: boolean): HTMLElement {
    const caja = el('div', 'tarjeta pregunta')
    caja.append(el('div', 'etiqueta', 'Pregunta'))
    const elegido = new Map<string, Set<string>>()

    for (const pregunta of q.questions) {
      const clave = pregunta.question
      elegido.set(clave, new Set())
      caja.append(el('div', 'nombre', pregunta.header || 'Claude pregunta'), el('div', 'texto-pregunta', clave))
      const opciones = el('div', 'opciones')
      for (const opcion of pregunta.options) {
        const b = boton(opcion.label, 'boton opcion', () => {
          const set = elegido.get(clave)
          if (!set) return
          if (pregunta.multiSelect) {
            if (set.has(opcion.label)) set.delete(opcion.label)
            else set.add(opcion.label)
          } else {
            set.clear()
            set.add(opcion.label)
          }
          for (const otro of opciones.querySelectorAll('button')) {
            otro.classList.toggle('elegida', set.has(otro.dataset.label ?? ''))
          }
          actualizarEnvio()
        })
        b.dataset.label = opcion.label
        b.disabled = !control
        b.append(el('span', 'ruta', recorta(opcion.description, 120)))
        opciones.append(b)
      }
      caja.append(opciones)
    }

    const responder = boton('Responder', 'boton si', () => {
      const answers: Record<string, string> = {}
      for (const [clave, set] of elegido) answers[clave] = [...set].join(', ')
      responder.disabled = true
      tienda.quitarPregunta(q.tabId, q.requestId)
      void api.responderPregunta(q.tabId, q.requestId, answers).catch(tratarFallo)
    })
    const descartar = boton('Descartar', 'boton no', () => {
      descartar.disabled = true
      tienda.quitarPregunta(q.tabId, q.requestId)
      void api.responderPregunta(q.tabId, q.requestId, null).catch(tratarFallo)
    })
    function actualizarEnvio(): void {
      responder.disabled = !control || [...elegido.values()].some((s) => s.size === 0)
    }
    descartar.disabled = !control
    actualizarEnvio()
    caja.append(fila('acciones', responder, descartar))
    if (!control) caja.append(el('div', 'pista', 'Toma el control para responder.'))
    return caja
  }

  function pintarTodos(): void {
    const todos = tienda.entrada(tabId)?.snapshot?.todos ?? []
    tiraTodos.hidden = todos.length === 0
    if (!todos.length) return
    const hechos = todos.filter((t) => t.status === 'completed').length
    const curso = todos.find((t) => t.status === 'in_progress')
    resumenTodos.textContent = `Tareas ${hechos}/${todos.length}${curso ? ` · ${recorta(curso.activeForm || curso.content, 40)}` : ''}`
    listaTodos.replaceChildren(
      ...todos.map((t) => el('li', `todo ${t.status}`, t.content))
    )
  }

  function pintarSalud(): void {
    const e = tienda.entrada(tabId)
    const s = e?.snapshot
    if (!s) {
      tiraSalud.hidden = true
      return
    }
    tiraSalud.hidden = false
    const partes: string[] = []
    if (s.health.contextWindow) partes.push(`Contexto ${pctContexto(s.health)}%`)
    if (s.health.costUsd > 0) partes.push(`${s.health.costUsd.toFixed(2)} $`)
    if (s.health.numTurns) partes.push(`${s.health.numTurns} turnos`)
    if (e?.aviso) partes.push(e.aviso)
    if (e?.error) partes.push(recorta(e.error, 70))
    tiraSalud.textContent = partes.join(' · ')
  }

  function pintarComposer(): void {
    const control = tienda.tieneControl(tabId)
    const listo = tienda.conectado && control
    campo.disabled = !listo
    enviar.disabled = !listo || !campo.value.trim()
    campo.placeholder = !tienda.conectado
      ? 'Sin conexión con el PC'
      : control
        ? 'Escribe a Claude…'
        : 'Toma el control para escribir'
  }

  function refrescar(): void {
    pintarCabecera()
    pintarDueno()
    pintarHilo()
    pintarStream()
    pintarPendientes()
    pintarTodos()
    pintarSalud()
    pintarComposer()
  }

  const dejarDeEscuchar = tienda.escuchar((temas) => {
    if (temas.has(temaChat(tabId)) || temas.has(TEMA_TABS) || temas.has(TEMA_CONEXION)) refrescar()
  })

  hilo.replaceChildren(cargador, burbujaStream, pendientes, zonaAviso)
  burbujaStream.hidden = true
  refrescar()
  if (!tienda.chat(tabId).cargado) {
    tienda.cargarChat(tabId).catch((err: unknown) => {
      if (err instanceof api.TokenMuerto) return
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo cargar', () => {
          zonaAviso.replaceChildren()
          void tienda.cargarChat(tabId)
        })
      )
    })
  }
  ajustarAlto()

  return { nodo, destruir: dejarDeEscuchar }
}
