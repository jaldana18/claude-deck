import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const version = String(JSON.parse(readFileSync('package.json', 'utf8')).version)

/**
 * Cliente web del acceso remoto. Vive aparte de electron-vite porque no es un
 * renderer de Electron: es una página que se sirve por HTTP a un móvil y no
 * tiene acceso a nada de Node.
 */
export default defineConfig({
  root: 'src/web',
  // El cliente lleva grabada la versión con la que se compiló: el PC dice la
  // suya al saludar y así la app sabe que la que corre se quedó vieja.
  define: { __VERSION__: JSON.stringify(version) },
  // Rutas relativas: el gateway sirve la página en la raíz de su origen, y con
  // base absoluta el service worker y el manifest se romperían tras un túnel.
  base: './',
  build: {
    outDir: '../../out/web',
    emptyOutDir: true,
    target: 'es2022',
    // El polyfill de modulepreload mete un script inline, y la CSP del gateway
    // solo admite scripts del propio origen.
    modulePreload: { polyfill: false }
  }
})
