import { describe, expect, it } from 'vitest'
import { hayCodigo, invitacion } from '../src/web/invitacion'

describe('invitación en la URL', () => {
  it('lee el código del fragmento y lo normaliza', () => {
    expect(invitacion('#c=abcd2345', false)).toBe('ABCD2345')
  })

  it('lo encuentra aunque vaya detrás de otra cosa', () => {
    expect(invitacion('#/chat/tab-1?c=ABCD2345', false)).toBe('ABCD2345')
    expect(invitacion('#x=1&c=ABCD2345', false)).toBe('ABCD2345')
  })

  it('sin código no hay invitación', () => {
    expect(invitacion('', false)).toBeNull()
    expect(invitacion('#/panel', false)).toBeNull()
    expect(invitacion('#c=ab-cd', false)).toBeNull()
  })

  it('un dispositivo ya vinculado no gasta el código ni vuelve a preguntar', () => {
    expect(invitacion('#c=ABCD2345', true)).toBeNull()
  })

  it('la barra se limpia aunque el código no se use: no debe quedar en el historial', () => {
    expect(hayCodigo('#c=ABCD2345')).toBe(true)
    expect(hayCodigo('#/panel')).toBe(false)
  })
})
