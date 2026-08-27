import { describe, expect, it } from 'vitest'
import {
  MAX_QUEUE,
  canQueue,
  dequeue,
  enqueue,
  queueLabel,
  removeQueued,
  type QueuedAttachment,
  type QueuedMessage
} from '../src/shared/messageQueue'

const msg = (id: string, text = `texto ${id}`, attachments: QueuedAttachment[] = []): QueuedMessage => ({
  id,
  text,
  attachments,
  queuedAt: 1_000
})

const img = (name = 'captura.png'): QueuedAttachment => ({
  name,
  mediaType: 'image/png',
  dataBase64: 'AAAA',
  dataUrl: 'data:image/png;base64,AAAA'
})

describe('enqueue', () => {
  it('añade al final conservando el orden', () => {
    const q = enqueue(enqueue([], msg('a')), msg('b'))
    expect(q.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('ignora un mensaje sin texto ni adjuntos', () => {
    expect(enqueue([], msg('a', '   '))).toEqual([])
  })

  it('acepta un mensaje sin texto si trae adjuntos', () => {
    expect(enqueue([], msg('a', '', [img()]))).toHaveLength(1)
  })

  it('no crece por encima del tope', () => {
    let q: QueuedMessage[] = []
    for (let i = 0; i < MAX_QUEUE + 5; i++) q = enqueue(q, msg(`m${i}`))
    expect(q).toHaveLength(MAX_QUEUE)
    expect(canQueue(q)).toBe(false)
  })

  it('no muta la cola original', () => {
    const original = [msg('a')]
    enqueue(original, msg('b'))
    expect(original).toHaveLength(1)
  })
})

describe('dequeue', () => {
  it('saca el primero y devuelve el resto', () => {
    const { next, rest } = dequeue([msg('a'), msg('b')])
    expect(next?.id).toBe('a')
    expect(rest.map((m) => m.id)).toEqual(['b'])
  })

  it('con la cola vacía devuelve null en vez de lanzar', () => {
    expect(dequeue([]).next).toBeNull()
  })
})

describe('removeQueued', () => {
  it('quita por id', () => {
    expect(removeQueued([msg('a'), msg('b')], 'a').map((m) => m.id)).toEqual(['b'])
  })

  it('devuelve la misma referencia si el id no está', () => {
    const q = [msg('a')]
    // identidad, no igualdad: evita re-disparar el efecto de drenado
    expect(removeQueued(q, 'zzz')).toBe(q)
  })
})

describe('queueLabel', () => {
  it('colapsa saltos de línea en una sola', () => {
    expect(queueLabel(msg('a', 'primera\n\n  segunda'))).toBe('primera segunda')
  })

  it('recorta con puntos suspensivos', () => {
    const largo = 'x'.repeat(200)
    const out = queueLabel(msg('a', largo), 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('…')).toBe(true)
  })

  it('no recorta lo que ya cabe', () => {
    expect(queueLabel(msg('a', 'corto'), 20)).toBe('corto')
  })

  it('describe los adjuntos cuando no hay texto', () => {
    expect(queueLabel(msg('a', '', [img()]))).toBe('📎 1 imagen')
    expect(queueLabel(msg('a', '', [img(), img()]))).toBe('📎 2 imágenes')
  })

  it('marca con clip el texto que además lleva imagen', () => {
    expect(queueLabel(msg('a', 'mira esto', [img()]))).toBe('📎 mira esto')
  })
})
