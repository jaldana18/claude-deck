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
npm run typecheck  # tsc --noEmit — única verificación del proyecto por ahora
npm run dist       # instalador NSIS en release/
```

## Pautas

- El código, los comentarios y la UI están en **español**; mantén ese idioma.
- `src/shared/types.ts` es el contrato IPC: si lo tocas, revisa main (handler),
  preload (puente) y el componente que lo consume.
- No edites `package.json` con PowerShell 5.1 (`Set-Content`/`Out-File` meten
  BOM y rompen el parseo de Vite); usa un editor o Node.
- Antes de abrir un PR corre `npm run typecheck` y prueba `npm run dev`.
- Para bugs, abre un issue con pasos de reproducción y versión de la app
  (visible en la barra de estado).

## Áreas donde se agradece ayuda

- Soporte macOS/Linux (hoy todo es Windows-first: ConPTY, PowerShell, NSIS).
- Tests automatizados (no hay ninguno todavía).
- Firma de código para el instalador.
