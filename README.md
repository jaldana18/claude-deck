# Claude Deck

App de escritorio para Windows con **sesiones de Claude Code por pestañas** que
sobreviven al reinicio del PC (estilo Notepad de Windows 11), en dos modos por pestaña:

- **💬 Chat (v2)**: interfaz estilo cliente LLM sobre el Claude Agent SDK — markdown
  renderizado, streaming token a token, tarjetas de permisos con botones, **botón de
  stop + Ctrl+C/Esc para interrumpir**, selector de modo de permisos, costo por sesión,
  y un terminal PowerShell colapsable abajo estilo VS Code (`` Ctrl+` ``).
- **⌨️ Terminal clásico**: la TUI de claude a pantalla completa, como en la consola.

Incluye un panel visual por proyecto para agentes, skills, hooks y MCP servers
(estilo Google AI Studio) y decisión explícita por proyecto sobre usar o no la
configuración global del PC (~/.claude).

## Modo chat (v2)

- **Sin costo extra de tokens**: el modelo emite el mismo markdown que en la TUI; la app
  solo lo renderiza. El costo estimado que muestra el header lo reporta el propio SDK.
- **Detener ejecución**: botón ⏹ rojo (header y junto al input), `Ctrl+C` (si no hay texto
  seleccionado) y `Esc`. Usa `interrupt()` del SDK: corta la generación sin matar la sesión.
- **Permisos**: en modo «Preguntar», cada acción muestra una tarjeta Permitir / Permitir
  siempre / Denegar («siempre» persiste la regla vía las sugerencias del SDK). El selector
  del header cambia entre Preguntar / Auto-editar / Auto total / Plan en vivo.
- **Agentes globales**: al crear una pestaña chat, si el PC tiene agentes en
  `~/.claude/agents` se listan y decides si la sesión usa la config global o solo la del
  proyecto (`settingSources` del SDK); la decisión se recuerda por proyecto.
- **Resurrección**: el historial se repinta desde el transcript local y la sesión continúa
  con `resume` — igual que las pestañas de terminal.
- Los slash commands (`/compact`, etc.) y `ultrathink` se escriben en el chat como siempre.
- Requiere Claude Code instalado en el PC (npm global o instalador nativo): el binario que
  el SDK trae embebido se excluye del instalador para no inflarlo ~280 MB.

## Ejecutar

```powershell
npm install        # solo la primera vez
npm run dev        # desarrollo (hot reload del renderer)
# o
npm run build      # compilar
npm start          # ejecutar la versión compilada
```

## Qué hace

### Pestañas que reviven
- Cada pestaña lanza PowerShell + `claude` en la carpeta del proyecto (terminal real:
  `/resume`, `ultrathink`, `/compact` y todo lo demás funciona igual que siempre).
- La app detecta automáticamente el **session id** de Claude Code observando
  `~/.claude/projects/<proyecto>/*.jsonl` y lo guarda por pestaña.
- El contenido visible del terminal (scrollback) se serializa cada 5 segundos.
- Al reabrir la app (o tras reiniciar el PC), cada pestaña restaura su scrollback y
  relanza `claude --resume <session-id>`: el chat continúa exactamente donde iba.
- La barra de estado muestra la ruta (clic para cambiarla) y el session id activo.

### Panel de configuración por proyecto (Ctrl+Shift+G)
- Lista agentes, skills, hooks, MCP servers y CLAUDE.md, fusionando el nivel usuario
  (`~/.claude/`) y el nivel proyecto (`.claude/`), con badge de origen y estado.
- Interruptores para activar/desactivar:
  - Agentes/skills: renombrado a `*.deck-disabled` (reversible al 100%).
  - Hooks y MCP del proyecto: la entrada se mueve íntegra a `.claude/deck-disabled.json`
    y vuelve exacta al reactivar. Siempre se hace backup previo en `.deck-backups/`.
  - Los MCP a nivel usuario (viven en `~/.claude.json`) se muestran en solo lectura.
- Los cambios aplican a sesiones nuevas de Claude o tras relanzar la pestaña.

### Crear agentes / skills / hooks con validación IA
- Botón «+ Nuevo» en cada sección. Antes de escribir nada en disco, el borrador pasa por
  una **sesión headless de Claude Code** (`claude -p --output-format json`) que evalúa si
  tiene lo mínimo viable: descripción sin ambigüedad, propósito concreto, sin solaparse
  con los existentes, evento/comando válidos en el caso de hooks.
- Si es viable → se crea. Si no → muestra problemas, sugerencias y una **versión mejorada**
  que puedes aplicar con un clic (o crear de todos modos bajo tu responsabilidad).

### Notificaciones de estado
- Banner «Activar» en el panel: instala hooks `Stop` / `Notification` / `UserPromptSubmit`
  en `.claude/settings.local.json` del proyecto que reportan a un servidor local de la app
  (puerto 43117).
- Cada pestaña muestra un punto de color: azul = trabajando, amarillo = pide tu atención
  (permiso/pregunta), verde = terminó, rojo = proceso cerrado.
- Si la ventana no tiene el foco, llega una notificación de Windows.
- Con la app cerrada los hooks no molestan (hacen `try/catch` y salen con código 0).

### Paleta de comandos (Ctrl+Shift+P)
- Snippets globales o por proyecto (prompts frecuentes, `/resume`, `ultrathink`, …).
- Enter inserta el texto en la pestaña activa; los snippets pueden auto-enviarse con ⏎.

### Búsqueda global de chats (Ctrl+Shift+F)
- Busca texto en todas las conversaciones locales de Claude Code (`~/.claude/projects`).
- Un clic sobre el resultado abre una pestaña nueva con `claude --resume` de esa sesión.

## Actualización automática

La app instalada revisa cada 4 horas (y al arrancar) la carpeta `release/` de este
proyecto. Cuando `npm run dist` genera un Setup con versión mayor a la instalada,
aparece un banner «Instalar y reiniciar»: corre el instalador en silencio (`/S`),
relanza la app y conserva pestañas y sesiones. Flujo para publicar una versión:

1. Sube `version` en `package.json` (ej. 0.2.0 → 0.3.0).
2. `npm run dist`.
3. La app instalada ofrecerá la actualización sola (no hace falta desinstalar nada:
   el mismo appId instala encima).

Si el proyecto se mueve de carpeta, ajusta `DEFAULT_UPDATE_DIR` en
`src/shared/constants.ts`.

**Actualización en equipo**: la carpeta vigilada es configurable — clic derecho en el
chip de versión (barra de estado) → elegir una carpeta compartida (OneDrive/SharePoint
o recurso de red). Cada miembro la configura una vez; al publicar, se copia el Setup
nuevo a esa carpeta y todos reciben el banner de actualización. Para distribución
pública, el mecanismo se sustituiría por `electron-updater` con GitHub Releases.

## Novedades v0.3.0

- **Imágenes en el chat**: pega (Ctrl+V), arrastra o usa 📎 (máx. 4, 5 MB c/u). Se envían
  como bloques base64 al SDK; las burbujas y el historial las muestran (clic = zoom).
- **Tema claro**: botón ☀️/🌙 en la barra; persiste entre sesiones. Terminal y bloques de
  código se mantienen oscuros (estilo VS Code).
- **Autocompletado de comandos**: escribe `/` y aparece el menú con los comandos reales de
  la sesión (los reporta el SDK: /compact, /clear, tus skills, etc.). `/clear` además
  limpia visualmente el chat.
- **Navegación**: `Ctrl+Tab`/`Ctrl+Shift+Tab` ciclan pestañas, `Ctrl+1..8` directo,
  `Ctrl+9` última — funcionan incluso con el foco dentro de un terminal.
- **Split de terminales** (estilo Windows Snap): 1 panel, 2 columnas, 2 filas o 2x2, tanto
  en el terminal inferior del chat como en pestañas clásicas. Cada panel es un PowerShell
  independiente con su propio scrollback persistente.
- **Historial de sesiones** (🕘 / `Ctrl+Shift+H`): panel izquierdo con las sesiones del
  proyecto; clic = restaurar esa sesión en la pestaña actual (equivalente a /resume).
- **Plan de tareas de Claude**: panel derecho que espeja los todos (TodoWrite) en vivo —
  pendientes ⚪, en curso 🔄, completadas ✅.
- **Chat de subagentes**: cuando Claude despliega subagentes, la tarjeta del tool muestra
  «👁 ver chat del subagente» con su transcript.

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+Shift+T` | Nueva pestaña (elige carpeta) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Pestaña siguiente / anterior |
| `Ctrl+1..8`, `Ctrl+9` | Ir a pestaña N / última |
| `Ctrl+Shift+P` | Paleta de comandos / snippets |
| `Ctrl+Shift+F` | Buscar en todos los chats |
| `Ctrl+Shift+H` | Historial de sesiones del proyecto |
| `Ctrl+Shift+G` | Mostrar/ocultar panel de configuración |
| `` Ctrl+` `` | Mostrar/ocultar terminal inferior (pestañas chat) |
| `Ctrl+C` / `Esc` | Detener la ejecución del chat |
| Clic central en pestaña | Cerrar pestaña |

## Arquitectura

```
src/main/          proceso principal de Electron
  chatSession.ts   sesiones de chat sobre el Agent SDK (streaming, interrupt, permisos)
  transcript.ts    historial del chat vía getSessionMessages del SDK
  ptys.ts          un ConPTY por pestaña (@lydell/node-pty, binarios precompilados)
  store.ts         persistencia JSON (pestañas, snippets, prefs por proyecto)
  sessionTracker.ts  session id por polling (solo pestañas de terminal clásico)
  configScanner.ts   lectura fusionada de agentes/skills/hooks/MCP/CLAUDE.md
  configToggle.ts    activar/desactivar con backups
  validator.ts       validación IA (claude -p headless) + escritura de artefactos
  hookServer.ts      servidor HTTP local para hooks (pestañas de terminal clásico)
  chatSearch.ts      búsqueda en streaming sobre los .jsonl
src/preload/       puente contextBridge (window.deck)
src/renderer/      UI React: ChatView/ChatTabView (v2) + xterm.js + panel de config
```

## Notas y límites conocidos (v1)

- Cerrar una pestaña no borra la conversación: sigue en `~/.claude/projects` y puede
  recuperarse con la búsqueda global.
- Si abres dos pestañas del mismo proyecto casi a la vez, la asignación pestaña↔sesión
  se corrige sola en cuanto llega el primer evento de hook (que trae el session id real).
- El validador IA usa tu instalación local de `claude` y consume tokens de tu plan.
- Otros CLIs (Gemini, Codex, aider…) corren en pestañas de perfil `shell`, pero sin
  resurrección de chat ni panel de configuración (previsto como «perfiles» en v2).
