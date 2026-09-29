import { defineConfig } from 'vitest/config'

export default defineConfig({
  // La inyecta `vite.web.config.ts` al compilar el cliente; aquí basta con que
  // exista para poder importar sus módulos.
  define: { __VERSION__: JSON.stringify('0.0.0-pruebas') },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
