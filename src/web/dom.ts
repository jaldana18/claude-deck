/** Cuatro ayudas para escribir DOM a mano sin repetir el mismo ritual. */

export function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase = '',
  texto = ''
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta)
  if (clase) nodo.className = clase
  if (texto) nodo.textContent = texto
  return nodo
}

export function boton(texto: string, clase: string, alPulsar: () => void): HTMLButtonElement {
  const b = el('button', clase, texto)
  b.type = 'button'
  b.addEventListener('click', alPulsar)
  return b
}

export function fila(clase: string, ...hijos: Node[]): HTMLDivElement {
  const d = el('div', clase)
  d.append(...hijos)
  return d
}

/**
 * Texto de un mensaje con los bloques de código separados. No hay intérprete de
 * markdown —serían dependencias— pero el código sin formato monoespaciado es
 * ilegible en un móvil, y es la mitad de lo que dice Claude.
 */
export function textoRico(texto: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  const trozos = texto.split('```')
  trozos.forEach((trozo, i) => {
    if (i % 2 === 0) {
      if (trozo.trim()) frag.append(el('div', 'parrafo', trozo.replace(/^\n+|\n+$/g, '')))
      return
    }
    const salto = trozo.indexOf('\n')
    const cuerpo = salto >= 0 ? trozo.slice(salto + 1) : trozo
    const lengua = salto >= 0 ? trozo.slice(0, salto).trim() : ''
    const caja = el('div', 'codigo')
    if (lengua) caja.append(el('div', 'lengua', lengua))
    caja.append(el('pre', '', cuerpo.replace(/\n+$/, '')))
    frag.append(caja)
  })
  return frag
}

export function avisoError(texto: string, reintentar?: () => void): HTMLElement {
  const nodo = el('div', 'aviso-error')
  nodo.append(el('span', '', texto))
  if (reintentar) nodo.append(boton('Reintentar', 'chip', reintentar))
  return nodo
}

export function recorta(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}
