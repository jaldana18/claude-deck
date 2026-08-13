# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Claude Deck: app Electron **solo para Windows** con sesiones de Claude Code por pestañas que sobreviven al reinicio del PC. Dos modos por pestaña: **chat** (UI tipo cliente LLM sobre `@anthropic-ai/claude-agent-sdk`) y **terminal clásico** (la TUI de `claude` en un ConPTY vía `@lydell/node-pty`).

## Comandos

```powershell
npm run dev        # desarrollo con hot reload del renderer (electron-vite)
npm run build      # compilar a out/
npm start          # ejecutar la versión compilada (electron-vite preview)
npm run typecheck  # tsc --noEmit — única verificación del proyecto (no hay tests ni linter)
npm run dist       # build + electron-builder → instalador NSIS en release/
```

Requiere Claude Code instalado en el PC: el binario embebido del SDK (~280 MB) se excluye del instalador, y `resolveClaudeCli()` en `src/main/chatSession.ts` lo busca en node_modules (dev), npm global o `~/.local/bin`.

Para publicar una versión: subir `version` en `package.json` y correr `npm run dist`. La app instalada vigila una carpeta de actualizaciones configurable (`store.updateDir`; en dev el fallback es la `release/` del proyecto — ver `src/main/updater.ts`) y se auto-actualiza.

## Arquitectura

Tres procesos Electron con aislamiento estricto (`contextIsolation`, sin `nodeIntegration`):

- **`src/main/`** — toda la lógica. `index.ts` instancia los singletons (Store, PtyManager, SessionTracker, HookServer, ChatSessionManager, Updater) y registra todos los handlers IPC; es el mapa del backend.
- **`src/preload/index.ts`** — expone la API completa como `window.deck` vía contextBridge. Su tipado para el renderer vive en `src/renderer/src/deck.d.ts`.
- **`src/renderer/`** — React 19 + xterm.js. `App.tsx` orquesta pestañas/paneles/atajos; `ChatView.tsx` es el componente grande del modo chat.

**`src/shared/types.ts` es el contrato IPC**: cualquier cambio ahí suele implicar tocar main (handler), preload (puente), `deck.d.ts` y el componente que lo consume. También contiene los helpers de paneles (`paneIdsFor`, `paneTabId`): un "pane" es un PTY independiente; el pane principal de una pestaña comparte id con la pestaña (`tab.id`), los splits usan ids derivados.

### Flujo del modo chat (v2)

`ChatSession` (una por pestaña chat) usa el SDK **siempre en modo streaming input** (AsyncGenerator) porque es el único que soporta `interrupt()` y `setPermissionMode()` en vivo. Los permisos llegan por `canUseTool`, se guardan como promesas pendientes en un Map por `requestId`, se mandan al renderer como tarjetas y se resuelven vía `chat:permission-response`. El historial no se guarda en la app: se repinta desde el transcript local del SDK (`transcript.ts` → `getSessionMessages`) y la sesión continúa con `resume`.

### Resurrección de sesiones

- Persistencia en `userData/deck-state.json` (pestañas, snippets, prefs por proyecto) + un archivo por pane con el scrollback serializado (`store.ts`).
- Al arrancar, `startTab()` relanza cada pestaña guardada: chat con `resume: claudeSessionId`, terminal con `claude --resume <id>`.
- El session id de pestañas terminal se detecta por polling de `~/.claude/projects/<proyecto>/*.jsonl` (`sessionTracker.ts`) y se corrige con el primer evento de hook que llegue.

### Integración con la config de Claude Code

- `configScanner.ts` fusiona nivel usuario (`~/.claude/`) y proyecto (`.claude/`) para agentes/skills/hooks/MCP/CLAUDE.md.
- `configToggle.ts` desactiva de forma reversible: renombrado a `*.deck-disabled` (agentes/skills) o movida de la entrada a `.claude/deck-disabled.json` (hooks/MCP), siempre con backup en `.deck-backups/`.
- `hookServer.ts` escucha en el puerto **43117** (fijo, `DECK_PORT`); instala hooks `Stop`/`Notification`/`UserPromptSubmit` marcados con `DECK_HOOK_MARKER` en el `settings.local.json` del proyecto para reportar estado por pestaña.
- `validator.ts` valida borradores de agentes/skills/hooks con una sesión headless (`claude -p --output-format json`) antes de escribirlos a disco.

## Notas

- Todo Windows-first: rutas con `APPDATA`, PowerShell como shell, ConPTY, instalador NSIS. No hay soporte macOS/Linux.
- Comentarios de código, README y UI en español; mantener ese idioma.
- `@lydell/node-pty` va en `asarUnpack` (binarios nativos precompilados); el paquete `claude-agent-sdk-win32-x64` se excluye del empaquetado en `package.json > build.files`.
