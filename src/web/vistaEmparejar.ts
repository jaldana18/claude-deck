import * as api from './api'
import { boton, el } from './dom'
import { arranque, arrancarSesion, pedirNotificaciones } from './sesion'
import { ir, type Vista } from './vistas'

/** Pantalla de emparejamiento: la única que se ve sin token. */
export function vistaEmparejar(): Vista {
  const nodo = el('div', 'pantalla centrada')
  const caja = el('div', 'caja')
  const aviso = el('div', 'aviso-error')
  aviso.hidden = true

  caja.append(
    el('div', 'marca', 'Claude Deck'),
    el('p', 'explica', 'Conecta este dispositivo con tu PC para seguir y contestar tus conversaciones desde aquí.')
  )

  const campoCodigo = el('input', 'campo-codigo')
  campoCodigo.type = 'text'
  campoCodigo.inputMode = 'text'
  campoCodigo.autocapitalize = 'characters'
  campoCodigo.autocomplete = 'off'
  campoCodigo.spellcheck = false
  campoCodigo.maxLength = 8
  campoCodigo.placeholder = 'ABCD2345'
  campoCodigo.setAttribute('aria-label', 'Código de emparejamiento')
  campoCodigo.addEventListener('input', () => {
    campoCodigo.value = campoCodigo.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    actualizarBoton()
  })

  const campoNombre = el('input', 'campo-texto')
  campoNombre.type = 'text'
  campoNombre.autocomplete = 'off'
  campoNombre.value = api.nombreDispositivo()
  campoNombre.setAttribute('aria-label', 'Nombre de este dispositivo')

  const btn = boton('Vincular', 'boton principal', () => void vincular(campoCodigo.value))

  function actualizarBoton(): void {
    btn.disabled = campoCodigo.value.length !== 8
  }

  caja.append(
    el('label', 'etiqueta-campo', 'Código de 8 caracteres'),
    campoCodigo,
    el('label', 'etiqueta-campo', 'Nombre de este dispositivo'),
    campoNombre,
    btn,
    aviso,
    el(
      'p',
      'pista',
      'El código sale en el panel «Acceso remoto» del Deck, en tu PC, y caduca a los pocos minutos. Si escaneaste el QR, esto se hace solo.'
    )
  )
  nodo.append(caja)
  actualizarBoton()

  async function vincular(codigo: string): Promise<void> {
    aviso.hidden = true
    btn.disabled = true
    btn.textContent = 'Vinculando…'
    try {
      await api.emparejar(codigo, campoNombre.value.trim() || api.nombreDispositivo())
      arrancarSesion()
      void pedirNotificaciones()
      ir('#/')
    } catch (err) {
      aviso.hidden = false
      aviso.textContent = err instanceof Error ? err.message : 'No se pudo vincular'
      btn.textContent = 'Vincular'
      actualizarBoton()
    }
  }

  // El código de la invitación llega en el fragmento de la URL: así no viaja al
  // servidor ni queda en los registros del túnel. Se usa una vez y se descarta.
  const automatico = arranque.codigo
  arranque.codigo = null
  if (automatico) {
    campoCodigo.value = automatico
    void vincular(automatico)
  }

  return { nodo }
}
