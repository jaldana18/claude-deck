import { describe, expect, it } from 'vitest'
import { imageMediaType, isImagePath, relativeToCwd } from '../src/shared/paths'

describe('isImagePath / imageMediaType', () => {
  it('reconoce las imágenes que el modelo ve nativamente', () => {
    expect(isImagePath('a/b/captura.PNG')).toBe(true)
    expect(imageMediaType('a/b/captura.PNG')).toBe('image/png')
    expect(imageMediaType('foto.jpeg')).toBe('image/jpeg')
    expect(imageMediaType('foto.jpg')).toBe('image/jpeg')
    expect(imageMediaType('anim.gif')).toBe('image/gif')
    expect(imageMediaType('logo.webp')).toBe('image/webp')
  })

  it('el código y los documentos NO son adjuntos: van como ruta', () => {
    expect(isImagePath('src/main/index.ts')).toBe(false)
    expect(isImagePath('informe.pdf')).toBe(false)
    expect(imageMediaType('src/main/index.ts')).toBeNull()
    // .svg no está: no es un formato de imagen que el modelo lea como tal
    expect(isImagePath('icono.svg')).toBe(false)
  })
})

describe('relativeToCwd', () => {
  const cwd = 'C:\\Users\\ana\\proyecto'

  it('recorta el cwd y normaliza a barras normales', () => {
    expect(relativeToCwd('C:\\Users\\ana\\proyecto\\src\\main\\index.ts', cwd)).toBe(
      'src/main/index.ts'
    )
  })

  it('es insensible a mayúsculas, como Windows', () => {
    expect(relativeToCwd('c:\\users\\ana\\proyecto\\src\\app.tsx', cwd)).toBe('src/app.tsx')
  })

  it('tolera una barra final en el cwd', () => {
    expect(relativeToCwd('C:/Users/ana/proyecto/a.txt', 'C:/Users/ana/proyecto/')).toBe('a.txt')
  })

  it('deja absoluta la ruta que cae fuera del proyecto', () => {
    // fuera del repo la relativa no identificaría el archivo
    expect(relativeToCwd('D:\\otro\\sitio\\x.md', cwd)).toBe('D:/otro/sitio/x.md')
  })

  it('no confunde un directorio hermano con un prefijo', () => {
    expect(relativeToCwd('C:\\Users\\ana\\proyecto-viejo\\x.ts', cwd)).toBe(
      'C:/Users/ana/proyecto-viejo/x.ts'
    )
  })

  it('el propio cwd es «.»', () => {
    expect(relativeToCwd(cwd, cwd)).toBe('.')
  })
})
