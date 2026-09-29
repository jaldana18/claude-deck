import { defineConfig } from 'vite'

/**
 * Cliente web del acceso remoto. Vive aparte de electron-vite porque no es un
 * renderer de Electron: es una página que se sirve por HTTP a un móvil y no
 * tiene acceso a nada de Node.
 */
export default defineConfig({
  root: 'src/web',
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
