import * as api from './api'
import { avisoError, boton, el, fila } from './dom'
import { tienda } from './estado'
import { ir, type Vista } from './vistas'

/**
 * Nuevo chat: navegador de carpetas. Sustituye al diálogo nativo del PC, que
 * desde fuera abriría una ventana delante de nadie.
 */
export function vistaCarpetas(): Vista {
  const nodo = el('div', 'pantalla')
  const atras = boton('←', 'icono', () => subir())
  const titulo = el('div', 'titulo-barra', 'Nuevo chat')
  const barra = fila('barra', atras, titulo)
  const ruta = el('div', 'ruta-actual')
  const lista = el('div', 'tarjetas')
  const zonaAviso = el('div', 'zona-aviso')
  const abrir = boton('Abrir chat aquí', 'boton principal', () => void crear())
  const pieAbrir = fila('pie-fijo', abrir)
  const cuerpo = fila('cuerpo', ruta, zonaAviso, lista)
  nodo.append(barra, cuerpo, pieAbrir)

  const pila: string[] = []
  let carpetas: api.NodoFs[] = []
  let cargando = true

  function dirActual(): string | null {
    return pila.length ? pila[pila.length - 1] : null
  }

  function subir(): void {
    if (!pila.length) {
      ir('#/')
      return
    }
    pila.pop()
    void cargar()
  }

  async function cargar(): Promise<void> {
    cargando = true
    zonaAviso.replaceChildren()
    pintar()
    try {
      const dir = dirActual()
      if (!dir) {
        const raices = await api.pedirRaices()
        carpetas = raices.map((r) => ({ name: r, path: r, isDir: true }))
      } else {
        carpetas = (await api.pedirCarpetas(dir)).filter((n) => n.isDir)
      }
    } catch (err) {
      carpetas = []
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo leer la carpeta', () => void cargar())
      )
    } finally {
      cargando = false
      pintar()
    }
  }

  async function crear(): Promise<void> {
    const dir = dirActual()
    if (!dir) return
    abrir.disabled = true
    abrir.textContent = 'Abriendo…'
    try {
      const tab = await api.crearPestana(dir)
      tienda.anadirPestana(tab)
      ir(`#/chat/${encodeURIComponent(tab.id)}`)
    } catch (err) {
      abrir.disabled = false
      abrir.textContent = 'Abrir chat aquí'
      zonaAviso.replaceChildren(
        avisoError(err instanceof Error ? err.message : 'No se pudo abrir el chat')
      )
    }
  }

  function pintar(): void {
    const dir = dirActual()
    ruta.textContent = dir ?? 'Carpetas disponibles'
    abrir.disabled = !dir || cargando
    pieAbrir.hidden = !dir

    if (cargando) {
      lista.replaceChildren(el('div', 'vacio', 'Cargando…'))
      return
    }
    if (!carpetas.length) {
      lista.replaceChildren(
        el('div', 'vacio', dir ? 'No hay subcarpetas aquí dentro.' : 'El PC no ofrece ninguna carpeta.')
      )
      return
    }
    lista.replaceChildren(
      ...carpetas.map((c) => {
        const b = el('button', 'tarjeta carpeta')
        b.type = 'button'
        b.append(el('span', 'nombre', c.name))
        if (c.path !== c.name) b.append(el('span', 'ruta', c.path))
        b.addEventListener('click', () => {
          pila.push(c.path)
          void cargar()
        })
        return b
      })
    )
  }

  void cargar()
  return { nodo }
}
