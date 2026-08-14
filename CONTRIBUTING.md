# Contribuir a Claude Deck

¡Gracias por tu interés! Claude Deck está en fase **alpha** y es **solo Windows**
por ahora; toda ayuda es bienvenida.

## Requisitos

- Windows 10/11
- Node.js 20+
- [Claude Code](https://claude.com/claude-code) instalado en el PC (npm global o
  instalador nativo): la app usa el CLI ya instalado, no lo trae embebido.

## Desarrollo

```powershell
npm install
npm run dev        # hot reload del renderer
npm run typecheck  # tsc --noEmit
npm test           # vitest: helpers puros (versiones, parseo MCP, CI, panes, grafo git)
npm run dist       # instalador NSIS en release/
```

Los tests cubren la lógica pura y frágil (comparación de versiones del
updater, extracción de JSON con preámbulo de los MCP, detección de proveedor
por el remote de git, ids de paneles y carriles del grafo). Si tocas algo de
eso, agrega el caso correspondiente en `test/`.

## Pautas

- El código, los comentarios y la UI están en **español**; mantén ese idioma.
- `src/shared/types.ts` es el contrato IPC: si lo tocas, revisa main (handler),
  preload (puente) y el componente que lo consume.
- No edites `package.json` con PowerShell 5.1 (`Set-Content`/`Out-File` meten
  BOM y rompen el parseo de Vite); usa un editor o Node.
- Antes de abrir un PR corre `npm run typecheck`, `npm test` y prueba `npm run dev`.
- Para bugs, abre un issue con pasos de reproducción y versión de la app
  (visible en la barra de estado).

## Áreas donde se agradece ayuda

- Soporte macOS/Linux (hoy todo es Windows-first: ConPTY, PowerShell, NSIS).
- Más cobertura de tests (hoy solo la lógica pura; falta la de componentes).
- Firma de código para el instalador.
