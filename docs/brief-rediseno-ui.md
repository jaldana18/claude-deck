# Claude Deck — Brief funcional para rediseño de UI/UX

> Documento para entregar a un modelo/diseñador externo. Describe **qué hace** la
> aplicación hoy (v0.34.8), pantalla por pantalla, para que se pueda rediseñar la
> interfaz **sin perder ninguna funcionalidad**. No describe la implementación salvo
> cuando condiciona la experiencia.

---

## 0. Qué se pide

Rediseñar la UI/UX completa de Claude Deck (app de escritorio + cliente móvil) con estos objetivos:

1. **Conservar el 100 % de las funcionalidades** listadas abajo. Se pueden reubicar, agrupar o simplificar, pero no eliminar.
2. **Reducir la carga visual y la densidad de controles**. Hoy hay muchos botones, chips y emojis compitiendo, sobre todo en el header del chat y en la barra superior.
3. **Unificar el lenguaje visual**: hoy conviven dos sistemas de modales, emojis mezclados con iconos SVG y comportamientos de teclado distintos según la pantalla (ver §12).
4. **Mejorar la descubribilidad**: hay funciones potentes (snap de pestañas, dividir widgets arrastrando, cola de mensajes, chat «Aparte») que solo se encuentran por casualidad.
5. Mantener dos temas: **claro (por defecto) y oscuro**, con la misma identidad.

**Entregables esperados:**
- Sistema de diseño: tokens de color, tipografía, espaciado, radios, sombras y movimiento, en claro y oscuro.
- Inventario de componentes: botones, chips, inputs, selects, toggles, sliders, tarjetas, modales, popovers, menús, tooltips, toasts, badges de estado y skeletons.
- Pantallas en alta fidelidad (HTML/CSS estático o React + CSS) de cada vista descrita en §3–§10, con sus estados vacío, carga, error y éxito.
- Propuesta de arquitectura de información: dónde vive cada acción y qué atajos tiene.
- Versión móvil (PWA) coherente con la de escritorio.

**Restricciones técnicas:**
- Es una app **Electron + React** (Windows). El rediseño debe poder implementarse con **HTML/CSS + React**, sin librerías de componentes pesadas. Se prefiere CSS con variables (custom properties).
- Las tipografías van empaquetadas localmente; hoy son **Geist Sans** (UI) y **JetBrains Mono** (código y terminal).
- El terminal es **xterm.js**: solo admite un tema de colores (fondo, texto, cursor y paleta ANSI de 16 colores), no CSS arbitrario.
- El chat recibe texto en **streaming** (token a token) y puede tener miles de mensajes: el diseño no debe depender de animaciones costosas por mensaje.
- Cada pestaña sigue viva aunque no esté visible. Puede haber de 1 a 4 pestañas en pantalla a la vez.
- Idioma de la UI: **español**.

---

## 1. Qué es Claude Deck

Aplicación de escritorio para Windows que envuelve **Claude Code** (el agente de programación de Anthropic) en una interfaz con **pestañas que sobreviven al reinicio del PC**. Cada pestaña es una sesión de trabajo sobre una carpeta de proyecto, en uno de dos modos:

- **Chat**: interfaz tipo cliente LLM sobre el Claude Agent SDK. Muestra markdown, el streaming, las tarjetas de permisos y preguntas, los subagentes, los widgets laterales y un terminal integrado abajo.
- **Terminal clásico**: la TUI del CLI a pantalla completa (Claude, Codex, Gemini o un comando personalizado), con hasta 4 terminales divididos.

Alrededor de eso hay un ecosistema:
- **Widgets laterales**: git, sprint de Azure DevOps, salud del contexto, pipelines, PRs, notas, archivos, logs, etc.
- **Panel de configuración** del proyecto: agentes, comandos, skills, hooks, MCP y CLAUDE.md.
- **Tienda** para instalar MCPs, agentes, skills y plugins.
- **Búsqueda global** de conversaciones e **historial** de sesiones.
- **Paleta de snippets**.
- **Acceso remoto desde el móvil** (PWA).
- **Modo bandeja** y **auto-actualización**.

**Usuario tipo**: desarrollador que trabaja todo el día con Claude Code en varios proyectos a la vez. Usa mucho el teclado, tiene varias sesiones en paralelo y necesita saber de un vistazo cuál está trabajando, cuál le pide algo y cuál terminó.

---

## 2. Identidad visual actual (punto de partida, no obligatorio)

Estilo «editor clásico + técnica cálida»:

| Token | Claro (por defecto) | Oscuro |
|---|---|---|
| Fondo app | `#f6f3ec` (crema) | `#1e1c19` |
| Panel | `#f0ece2` | `#242119` |
| Barra / pestañas | `#ebe6da` | `#171512` |
| Tarjeta | `#fdfcf9` | `#1a1815` |
| Texto / 2º / 3º | `#2b2823` / `#6d675c` / `#8a8375` | `#e8e4da` / `#a8a294` / `#8f887a` |
| Acento | `#b3541e` (terracota) | `#e0955f` |
| OK / Aviso / Ocupado / Peligro | `#4a9b6f` / `#d9a13b` / `#4a7bd0` / `#b03a2e` | iguales |
| Código | `#211f1b`, siempre oscuro | `#14120f` |

- Radios: tarjeta 8, popover 11, botón 7, pill 12.
- Texto base de 13 px.
- Botones: primario (acento), oscuro, fantasma y peligro.
- Chips seleccionables con `aria-pressed`.

El rediseño puede proponer otra paleta, pero debe mantener la **semántica de colores de estado**: azul = trabajando, amarillo = requiere atención, verde = terminado, rojo = caído/error, gris = en reposo.

---

## 3. Estructura de la ventana principal

De arriba a abajo:

1. **Banner de estado del servicio** (condicional): avisa si un modelo está fallando en este equipo o si Anthropic reporta una incidencia.
   - Tonos: aviso (ámbar) o grave (rojo).
   - Incluye el enlace «Ver el parte oficial» y los botones «Comprobar» y «Descartar».
2. **Banner de actualización** (condicional): «Hay una versión nueva (vX)».
   - Botón «Instalar y reiniciar», con progreso de descarga «Descargando… N%».
   - Botón «Después».
   - Si falla, el error se muestra en el propio banner.
3. **Barra de pestañas + acciones globales.**
4. **Cuerpo**:
   - Panel lateral izquierdo opcional: Historial de sesiones.
   - Área de trabajo (1, 2 o 4 celdas).
   - Panel lateral derecho opcional: Configuración del proyecto.
5. **Barra de estado** inferior.
6. Capa de **modales y overlays**.

### 3.1 Barra de pestañas

**Anatomía de una pestaña:**
- Icono del modo (chat / terminal).
- Título (en mono si es terminal).
- **Punto de estado**.
- ✕ para cerrar, visible al pasar el ratón o en la pestaña activa.
- El tooltip muestra la ruta del proyecto.

**Estados del punto:**

| Estado | Color | Animación | Significado |
|---|---|---|---|
| idle | gris | — | En reposo |
| working | azul | pulso | Claude está trabajando |
| attention | amarillo | pulso más rápido con brillo | Pide permiso o hizo una pregunta |
| done | verde | — | Terminó; se limpia al entrar en la pestaña |
| exited | rojo | — | El proceso murió (solo en terminal) |

**Interacciones:**
- Clic: activa la pestaña.
- Clic central: cierra la pestaña.
- **Arrastrar una pestaña** activa el «snap» (ver §3.3).
- Botón **«+»** al final: abre Nueva pestaña.
- Hoy **no existen**: renombrar, reordenar ni menú contextual. Son candidatos naturales para el rediseño.

**Acciones de la derecha:**
- **«+ Widget ▾»**: galería de widgets (§5).
- **Buscar**: búsqueda global de chats.
- **Selector de distribución**: 1 / 2 columnas / 2 filas / 2×2.
- **Botón de tema** ☀/☾. Debe seguir visible: lo pidió el usuario.
- **Menú «⋯»**:
  - Historial de sesiones
  - Paleta de comandos
  - Configuración
  - Tienda
  - Ajustes de la app
  - Acceso remoto
  - Tema
  - «Salir de Claude Deck» (solo en modo bandeja)

### 3.2 Barra de estado

- **📁 Ruta del proyecto**: clic para cambiar de carpeta.
- Chip de modo: chat o terminal.
- Id de sesión abreviado: indica que la sesión se reanudará al reiniciar.
- Pista de atajos.
- **Chip de versión**:
  - Clic: busca actualizaciones; muestra «✓ al día» durante 2,5 s o abre el banner.
  - Clic derecho: elegir una carpeta de actualizaciones compartida del equipo.

### 3.3 Dividir el área de trabajo

- Modos: 1 celda, 2 columnas, 2 filas o 2×2. Cada celda muestra una pestaña de chat o de terminal.
- Cada celda tiene un **selector de qué pestaña mostrar**. Si esa pestaña ya está en otra celda, se intercambian.
- La celda activa se marca con un contorno de acento. Hacer clic dentro de una celda la activa.
- **Snap arrastrando una pestaña**:
  - Arriba al centro aparece un selector con 3 miniaturas de distribución.
  - Las zonas de borde de 40 px resuelven la división: lados = columnas, arriba/abajo = filas, esquinas = cuadrante 2×2.
  - Un rectángulo de vista previa muestra dónde caerá. Esc cancela.

### 3.4 Estado vacío (sin pestañas)

- Logo y versión.
- Texto explicativo.
- Botón principal «+ Nueva pestaña».
- Lista de atajos.

---

## 4. Pestaña de Chat (la pantalla principal)

### 4.1 Layout

```
┌──────────────────── header del chat ─────────────────────┐
│ [barra de búsqueda en la conversación, opcional]         │
├────────┬───────────────────────────────────┬─────────────┤
│ dock   │  lista de mensajes (columna       │  dock       │
│ izq.   │  centrada, ~700 px)               │  der.       │
│ widgets│  ─────────────────────────────    │  widgets    │
│        │  adjuntos · cola · composer       │             │
├────────┴───────────────────────────────────┴─────────────┤
│ ▾ TERMINAL  (plegable, redimensionable, 1-4 instancias)  │
└──────────────────────────────────────────────────────────┘
```

Se pueden soltar archivos en cualquier punto del chat: las imágenes se adjuntan y el resto inserta su ruta.

### 4.2 Header del chat

- **Modo de permisos**, control segmentado:
  - Preguntar
  - Auto-editar
  - Auto total: pide confirmación porque aprueba también los comandos.
  - Plan
- **Selector de modelo**, cambia en vivo:
  - «auto», con el modelo real entre paréntesis.
  - Alias: default, opus, sonnet, haiku, fable, opusplan. Cada uno muestra a qué versión apunta hoy.
  - Versiones fijas agrupadas por familia, con su ventana de contexto (1M/200K) y la marca «se retira».
  - «Otro id…»: campo libre.
- **Selector de modelo de respaldo**: se usa si el principal está sobrecargado. Cambiarlo reinicia la sesión conservando la conversación.
- **Botón Parámetros del LLM**: se resalta si hay valores personalizados. Abre un popover (§4.8).
- **Chip «global ON/OFF»**: indica si la sesión usa la configuración global `~/.claude`.
- **Chip de costo** acumulado ($ con 4 decimales).
- **Botón de actividad**: solo aparece si hay plan o agentes. Muestra «completadas/total · N agentes activos» y añade o quita el widget Actividad.
- **Detener**: solo aparece mientras trabaja.

### 4.3 Lista de mensajes

- **Carga**:
  - Mientras carga se ve «Cargando conversación…».
  - Se muestran los últimos 60 mensajes; arriba, el botón «Cargar mensajes anteriores (N)».
- **Estado vacío**: título de la pestaña, carpeta y pistas (escribir `/` para ver los comandos, pegar imágenes).
- **Autoscroll**:
  - Sigue el final mientras el usuario está abajo.
  - Girar la rueda hacia arriba lo pausa.
  - Volver al fondo lo reanuda.
  - Enviar un mensaje fuerza a seguir.
  - *(Falta una píldora «↓ ir al final / N mensajes nuevos»: oportunidad de mejora.)*
- **Hora en cada mensaje**: HH:MM si es de hoy, fecha si no. El tooltip muestra la fecha completa.
- **Mensaje del usuario**: burbuja con texto y miniaturas de imágenes (clic = visor).
- **Mensaje del asistente**: sin burbuja, en markdown GFM:
  - Tablas y listas de tareas.
  - Código con resaltado sobre fondo oscuro.
  - Rutas y URLs clicables, que abren en VS Code, el navegador o la app del sistema. Se reconocen sufijos `:42`.
- **Streaming**: los párrafos ya completos se ven en markdown; el último va en texto plano con cursor ▍.
- **Tarjeta de herramienta**, plegable:
  - Cabecera: nombre de la herramienta y estado (ejecutando… / ✓ / error).
  - Al expandir: el input y el resultado.
- **Tarjeta de subagente** (herramienta Agent/Task):
  - Icono propio, duración y «ver subagente (N mensajes)».
  - Abre un visor con su conversación en vivo.
- **Avisos del sistema**: auto-compact en curso o terminado, tope de auto-compact alcanzado y «continuación automática n/5». Hoy se pintan como burbujas de usuario: **conviene un estilo propio**.
- **Error**: caja roja al final.
- No hay bloques de *thinking* visibles.

### 4.4 Tarjetas de permiso (en línea, al final de la lista)

Aparecen cuando Claude pide permiso para usar una herramienta.

- Título: «Claude quiere usar X» y una descripción opcional.
- **Detalle rico según la herramienta**:
  - Bash/PowerShell: el comando resaltado.
  - Edit/MultiEdit: ruta clicable y **diff** rojo/verde.
  - Write: el contenido completo resaltado.
  - Read/Grep/Web…: tabla clave→valor.
  - Otras: JSON.
  - Siempre está «Ver JSON crudo».
- Botones: **Permitir**, **Permitir siempre** (si aplica) y **Denegar**.
- Puede haber varias a la vez. Desaparecen si se cancelan.
- Si otro dispositivo tiene el control, quedan inactivas.

### 4.5 Tarjetas de pregunta (AskUserQuestion)

- «Claude necesita tu decisión».
- Una o varias preguntas, cada una con:
  - Encabezado (chip) y texto.
  - Opciones con etiqueta y descripción; selección única o múltiple.
  - Campo «Otra respuesta…».
- Botones: **Responder** (activo cuando todas tienen respuesta) y **Cerrar sin responder**.

### 4.6 Composer

- **Textarea**:
  - Crece de 1 a 5 líneas y luego hace scroll.
  - Placeholder con pistas: `/` comandos, Enter envía, Shift+Enter salto.
- **Acciones**:
  - 📎 Adjuntar imágenes.
  - Snippets: abre la paleta.
  - ⤢ **Editor grande**: modal de 760 px donde Enter hace salto y Ctrl+Enter envía.
  - **Enviar**: pasa a **Encolar** mientras Claude trabaja.
  - **Detener**.
- **Adjuntos**:
  - Máximo 10 imágenes de 5 MB cada una (PNG/JPG/GIF/WebP).
  - Se añaden pegando, arrastrando o con 📎.
  - Fila de miniaturas con ✕ y contador n/10.
- **Autocompletado de `/`**:
  - Hasta 14 comandos reales de la sesión, con descripción.
  - Navegación con ↑/↓, Tab/Enter y Esc.
- **Cola de mensajes**:
  - Mientras Claude trabaja se puede seguir escribiendo; los mensajes se encolan (máx. 25).
  - Franja «✉ N en cola · en pausa» con «Reanudar», «Vaciar» y ✕ por mensaje.
  - Se envían uno a uno al terminar cada turno.
  - Detener pausa la cola.
- **Barra de control remoto**: «El control lo tiene {dispositivo}» con el botón **Tomar el control**. Mientras tanto el composer queda deshabilitado.
- **Barra de compactación**: «Compactando el contexto…», segundos transcurridos y barra indeterminada.

### 4.7 Búsqueda dentro de la conversación (Ctrl+F)

- Barra bajo el header con el contador «N de M» y los botones ↑ ↓ ✕.
- Enter / Shift+Enter navegan entre coincidencias.
- Saltar a una coincidencia centra el mensaje y lo resalta con un destello.

### 4.8 Popover «Parámetros del LLM» (por pestaña)

- **Sliders tipo barra de volumen**:
  - Esfuerzo: low → max; muestra «default (high)» hasta que se toca.
  - Presupuesto de razonamiento: off / adaptativo / 4k / 8k / 16k / 32k.
  - Auto-compact: global / off / 100k / 150k / 200k / 300k.
- **Números** (placeholder ∞): máx. turnos y presupuesto en US$.
- **Textarea**: instrucciones extra para el system prompt.
- **Carpetas adicionales con acceso**: lista con ✕ y botón «+ Agregar carpeta».
- **Toggle** «Continuar solo al llegar al límite de turnos» (máx. 5 veces).
- **Nota**: la temperatura no está disponible y guardar reinicia la sesión (la conversación se conserva).
- **Botones**: Cancelar / Guardar y aplicar.

### 4.9 Terminal integrado (abajo, estilo VS Code)

- **Tamaño**:
  - Plegado mide 30 px; desplegado, 280 px por defecto.
  - Se redimensiona arrastrando la cabecera. Doble clic pliega o despliega.
  - Ctrl+` muestra u oculta.
- **Cabecera**:
  - «TERMINAL».
  - Selector de distribución.
  - **Shell**: PowerShell, CMD o Bash. Se recuerda por proyecto.
  - Ruta.
- **Instancias** a la derecha:
  - «›_ shell N»: clic muestra esa instancia sola.
  - «+» añade una (máx. 4).
  - «×» cierra la última.
  - ⌃/⌄ maximiza.
- **Copiar y pegar** estilo Windows Terminal:
  - Ctrl+C con selección copia; sin selección interrumpe.
  - Ctrl+Shift+V pega.
  - Clic derecho copia si hay selección y, si no, pega.
- **Proceso terminado**: barra «El proceso terminó» con el botón «Relanzar».
- El terminal **sigue el tema**: crema en claro, oscuro cálido en oscuro.

### 4.10 Modales del chat

- **Visor de imagen**.
- **Editor grande de mensaje**.
- **Visor de subagente**: título «tipo: descripción» y su conversación en vivo. Mientras arranca muestra un spinner.

---

## 5. Widgets laterales

**Dónde viven y cómo se gestionan:**
- Hay dos **docks** (izquierdo y derecho) por pestaña de chat, a toda la altura.
- Cada pestaña guarda su propio juego de widgets, que **se pueden repetir**; por ejemplo, dos widgets Git con repos distintos.
- **Para añadir**: desde la galería «+ Widget» (clic, o arrastrar al dock deseado) o desde la Tienda.

**Anatomía de un widget:**
- Cabecera con asa ⠿, icono, título, sufijo distintivo (repo, sprint, «3/7») y ✕.
- Cuerpo.
- Asa inferior de altura: automática por defecto, o fija.
- Asa lateral de ancho: 220–640 px.

**Ancho del dock**: asa en el borde interior (240–560 px), que se recuerda por lado.

**Arrastrar un widget:**
- Aparece un fantasma inclinado que sigue al cursor y zonas punteadas donde soltar.
- Al soltar:
  - En el tercio izquierdo o derecho de otro widget: se **emparejan lado a lado** (media columna).
  - En el centro de otro widget: se reordena.
  - Cerca de un dock: va a ese dock a ancho completo.
- Esc cancela, con animación de retorno.

**Los 14 tipos:**

| Widget | Qué muestra / permite |
|---|---|
| **Git** | Grafo de commits por carriles de colores, ramas y merges, refs, chip de rama, «± N» cambios. Carpeta configurable. Refresco 20 s. |
| **Sprint** | Board de Azure DevOps vía MCP. Configuración en cascada Proyecto → Equipo → Sprint («actual» automático). Filtro por responsable, barra de progreso, ítems agrupados por estado. |
| **Salud** | Límites de la suscripción (5 h, semanal, Opus, Sonnet) en semáforo. Barra de **contexto usado** (ok / ≥60 % aviso / ≥80 % alerta, con sugerencia de /compact). Uso frente a presupuesto y turnos. Salida, turnos, costo y modelo. |
| **Actividad** | Cola de mensajes, **agentes en ejecución** (punto pulsante, cronómetro, clic abre su chat) y plan. |
| **Tareas** | Plan de Claude con barra de progreso: ✓ / ◐ en curso / ○. Clic abre el detalle. |
| **Pipelines** | Builds recientes (GitHub Actions / Azure Pipelines / Bitbucket): estado, rama, «hace X». Clic abre la URL. |
| **Pull requests** | PRs abiertos: #id, título, borrador, rama, review, checks. |
| **Notas** | Bloc por widget: edición o vista markdown, copiar todo, autoguardado. |
| **Sesión** | Cronómetro grande, costo, turnos, tokens de entrada y salida. |
| **Portapapeles** | Últimas 20 copias. Clic recopia, doble clic inserta en el chat. |
| **Logs** | Ejecuta un comando (npm run dev, docker logs…) con filtro; resalta ERROR y WARN. |
| **Archivos** | Árbol del proyecto coloreado por estado git. Clic abre en el editor; doble clic o arrastrar lo manda al chat. |
| **Diff Stats** | +N / −N, archivos cambiados con mini barra, marca de staged. |
| **Aparte** | Mini-chat paralelo «pregunta al margen» que no toca el hilo principal. Modos «limpia» o «fork del hilo», con costo, interrumpir y reiniciar. |

Los widgets de pestañas ocultas no consultan nada.

**Estados que el diseño debe contemplar en todos:** cargando («Consultando vía MCP…»), vacío con pista, error en línea y sin configurar.

---

## 6. Pestaña de Terminal clásico

- Barra «Terminal clásico» con un selector de distribución propio (1 / 2 columnas / 2 filas / 2×2). Cada panel es un shell independiente.
- El panel principal corre el CLI elegido. Si es Claude, se reanuda la sesión con `--resume` al reiniciar.
- El contenido visible se guarda y se restaura: la pestaña «revive».
- Mismas reglas de copiar y pegar que el terminal del chat. Los atajos globales funcionan aunque el foco esté en el terminal.
- Si el proceso muere: «Relanzar (continúa la sesión)».

---

## 7. Modales y paneles

### 7.1 Nueva pestaña (Ctrl+Shift+T)

1. **Carpeta del proyecto**: selector.
2. **CLI**: chips Claude / Codex / Gemini / Personalizado.
   - Los no instalados aparecen deshabilitados con ⚠.
   - Personalizado pide el comando.
   - La elección se recuerda como predeterminada.
3. **Modo**: tarjetas Chat / Terminal clásico. Chat solo está disponible con Claude.
4. **Solo en Chat**: usar o no la configuración global `~/.claude`.
   - Se listan los agentes globales.
   - Radios Global / Solo proyecto.
   - «Recordar para este proyecto».
5. Botones Cancelar / Abrir pestaña.

**Primer arranque**: onboarding que detecta qué CLIs hay en el PATH y pide elegir el predeterminado.

### 7.2 Configuración del proyecto (panel lateral derecho, Ctrl+Shift+G)

- **Secciones plegables con contador**: Agentes, Comandos, Skills, Hooks, MCP servers, CLAUDE.md.
- **Cada elemento**:
  - Nombre y descripción.
  - Chip de alcance (usuario/proyecto).
  - **Interruptor activar/desactivar** reversible. Los MCP de usuario son de solo lectura.
  - **Vista previa al pasar el ratón**: muestra el contenido real del archivo.
- **Hooks**: evento · matcher · comando.
- **CLAUDE.md**: global y de proyecto, con su tamaño y ruta, o «No existe».
- **Banner** «Activa las notificaciones de estado»: instala los hooks que alimentan los puntos de estado de las pestañas de terminal.
- **«+ Nuevo»** en cada sección: abre el diálogo de creación (§7.3).
- Se refresca solo. Nota fija: «los cambios aplican a sesiones nuevas».

### 7.3 Diálogos de creación (agente, comando, skill, hook, plugin)

**Anatomía común:**
- Modal de 520 px.
- Cabecera: icono, título, selector de alcance Usuario/Proyecto y ×.
- Cuerpo con scroll.
- Pie: ruta destino en mono (cambia en vivo), Cancelar y botón primario, deshabilitado hasta que el formulario es válido.

**Agente:**
- Nombre en kebab-case validado en vivo.
- Modelo: heredar / haiku / sonnet / opus.
- Descripción.
- Herramientas en chips. Si se activa Bash, se despliega su lista blanca.
- Prompt de sistema, con el botón **«✦ Generar borrador con IA»**.
- Al guardar se pasa por **validación con IA**. Si hay avisos, sale una tarjeta ámbar con dos opciones:
  - «Aplicar versión mejorada»: los campos cambiados destellan.
  - «Ignorar y guardar».
- Si no es viable, el diálogo hace una sacudida.

**Comando:**
- Prefijo `/` fijo.
- Toggle `$ARGUMENTS`.
- Plantilla con `$ARGUMENTS` resaltado.
- **Vista previa de cómo se verá en el autocompletado**.

**Skill:**
- Nombre.
- «Cuándo se activa».
- Contenido de SKILL.md.
- **Archivos adjuntos**: arrastrar o elegir.

**Hook** (diálogo antiguo, pendiente de unificar):
- Alcance, evento (PreToolUse, Stop, etc.), matcher y comando.
- Flujo explícito «Validar con IA» → resultado con puntuación N/10, problemas y sugerencias → Crear / Crear de todos modos / Usar la versión mejorada.

**Plugin:**
- Fuente: Marketplace / Repo git / Carpeta local.
- Caja «Este plugin aporta»: comandos, agentes y hooks, con un badge «requiere revisión» si trae hooks.
- Toggles de permisos.
- Aviso de seguridad.
- Caja de resultado con la salida del CLI.

### 7.4 Tienda

**Pestañas:**
- **Widgets**: catálogo con «Agregar» o arrastrar directamente al dock (al empezar el arrastre, el modal se aparta).
- **Servidores MCP**:
  - Catálogo curado: filesystem, github, playwright, context7, memory, sequential-thinking, azure-devops, postgres.
  - Cada tarjeta muestra «Instalar» o «Instalado ✓».
  - Si faltan datos `<…>`, abre un formulario precargado.
  - Celda «+ servidor manual»: nombre, comando, argumentos y variables.
- **Agentes**: importar `.md` local o descargar desde una URL (los enlaces de GitHub se convierten a raw solos).
- **Skills**: importar una carpeta con SKILL.md o desde una URL.
- **Plugins**:
  - Asistente de instalación (§7.3).
  - Flujo manual: agregar marketplace → instalar nombre@marketplace.
  - «Ver marketplaces» y «Ver plugins instalados».

**Común a todas**: selector de alcance «Usuario» / «Proyecto»; estados «Trabajando…» y resultado en verde o rojo con la salida.

### 7.5 Ajustes de la app

- **Auto-compactar el contexto a partir de N tokens**:
  - Chips: Off / 100k / 150k (recomendado) / 200k / 300k, o un valor exacto.
  - Muestra una estimación del costo por turno.
  - Tope de 3 compactaciones seguidas.
- **Avisos de caída del servicio**: on/off y umbral de errores para dar un modelo por caído.
- **Modo bandeja**: al cerrar con ✕, seguir en segundo plano con icono junto al reloj, o cerrar todo.
- Botones Cancelar / Guardar; muestra «✓ Guardado».

### 7.6 Acceso remoto (para usar Claude Deck desde el móvil)

- **Estado**:
  - Botón Encender / Apagar.
  - Fase: Apagado / Abriendo túnel / Publicado / Caído.
  - URL pública.
- **Alertas**: autenticación bloqueada por intentos fallidos y errores (por ejemplo, falta cloudflared).
- **Cómo sale a internet**:
  - Túnel rápido: la dirección cambia en cada arranque.
  - Dominio propio: nombre público y token de Cloudflare, con pasos guiados.
  - Solo red local.
- **Añadir dispositivo** en 2 pasos:
  1. QR para instalar la PWA.
  2. «Generar código»: código de 8 caracteres, un solo uso, caduca en minutos, con su QR de vinculación.
- **Dispositivos con llave**: lista con «conectado», Revocar y Revocar todos.
- **Carpetas visibles desde fuera**: por defecto, las de las pestañas abiertas; se pueden añadir o quitar.
- **Apagado automático** tras N minutos sin dispositivos.
- **Un solo mando a la vez**: el otro dispositivo ve todo en vivo y puede «Tomar el control».

### 7.7 Historial de sesiones (panel lateral izquierdo, Ctrl+Shift+H)

- Sesiones previas del proyecto: resumen, primer prompt y «hace N min».
- La sesión actual va marcada.
- Clic restaura esa sesión en la pestaña actual.
- En pestañas de terminal se muestra deshabilitado, con una pista.

### 7.8 Búsqueda global de chats (Ctrl+Shift+F)

- Busca en todas las conversaciones guardadas de Claude Code. Requiere al menos 2 caracteres y espera a que se deje de escribir.
- Cada resultado: proyecto, fecha, número de coincidencias y fragmento.
- Clic abre o reanuda ese chat en una pestaña.

### 7.9 Paleta de comandos / snippets (Ctrl+Shift+P)

- Filtro y lista de snippets: nombre, marca «del proyecto», marca «se envía solo» y el texto.
- ↑/↓ y Enter insertan el snippet en la pestaña activa: en el composer si es chat, en el PTY si es terminal.
- «+ Snippet»:
  - Nombre y texto.
  - «Enviar con Enter automáticamente».
  - «Solo para este proyecto».
- Hoy no se pueden editar ni borrar snippets.

---

## 8. Notificaciones y avisos

- **Notificaciones nativas de Windows** cuando una pestaña termina o pide atención y la ventana no tiene el foco. Clic → abre la ventana.
- **No hay toasts dentro de la app**: todo se comunica con banners, chips («✓ al día»), cajas de error en línea y la barra de proceso terminado. *Un sistema de toasts unificado es una mejora candidata.*

---

## 9. Atajos de teclado

| Atajo | Acción |
|---|---|
| Ctrl+Shift+T | Nueva pestaña |
| Ctrl+Tab / Ctrl+Shift+Tab | Pestaña siguiente / anterior |
| Ctrl+1…8 / Ctrl+9 | Ir a la pestaña N / a la última |
| Ctrl+Shift+P | Paleta de snippets |
| Ctrl+Shift+F | Buscar en todos los chats |
| Ctrl+Shift+H | Historial de sesiones |
| Ctrl+Shift+G | Configuración del proyecto |
| Ctrl+` | Mostrar u ocultar el terminal del chat |
| Ctrl+F | Buscar en la conversación |
| Ctrl+C (sin selección) / Esc | Detener a Claude |
| Enter / Shift+Enter | Enviar o encolar / salto de línea |
| Ctrl+Enter | Enviar desde el editor grande |
| Clic central en una pestaña | Cerrar |
| Esc | Cancelar arrastres; cerrar visores y búsqueda |

---

## 10. Cliente móvil (PWA)

Una app web instalable («Añadir a pantalla de inicio») para seguir trabajando desde el teléfono. **La ejecución sigue en el PC**: el móvil solo ve y da instrucciones. Hoy es solo modo oscuro y vertical.

**Pantallas:**

1. **Emparejamiento**:
   - Código de 8 caracteres (o automático si se escaneó el QR) y nombre del dispositivo.
   - Botón «Vincular».
   - Pistas para instalar primero la app (caso iPhone).
2. **Panel «Conversaciones»**:
   - Tarjetas de los chats abiertos en el PC; las que esperan respuesta van primero y resaltadas.
   - Cada tarjeta: nombre, ruta, «Permiso: …» / «Pregunta: …», y chips de contexto %, costo, quién tiene el control, avisos y errores.
   - Acciones: «+ Nuevo chat» e «Historial».
   - Vacío o desconectado, con el botón «Sincronizar».
   - Pie con la versión.
3. **Conversación**:
   - Barra: ←, ☰ (saltar a otro chat), título, selector de modelo y Detener.
   - Banda «Controla X» con el botón «Tomar el control».
   - Burbujas en markdown con herramientas plegables.
   - Tarjetas de permiso y de pregunta.
   - Tira plegable de tareas y tira de salud.
   - Composer: borrador guardado, autocompletado de `/`, envío.
   - Desde el móvil **no** se puede: adjuntar, usar el terminal ni cambiar el modo de permisos.
4. **Carpetas**: navegar las carpetas permitidas → «Abrir chat aquí» o «Ver historial».
5. **Historial**: sesiones de una carpeta → transcripción de solo lectura → «Continuar en el PC».

**Transversales:**
- Banda «Sin conexión con el PC · reintentando…».
- Banda «Versión X: actualizando…».
- Notificaciones push de permiso o pregunta pendiente, incluso con la app cerrada.

---

## 11. Otras funciones sin pantalla propia (para tener en cuenta)

- **Resurrección**: al reabrir la app o reiniciar el PC, cada pestaña recupera su conversación y su terminal.
- **Modo bandeja**: la ✕ esconde la ventana y todo sigue corriendo. El menú del icono de la bandeja muestra cuántas sesiones hay vivas y la opción «Salir».
- **Auto-actualización** desde GitHub Releases (o una carpeta compartida), con banner y progreso.
- **Auto-compact** y **auto-continuación** (los avisos salen en el chat).
- **Rutas clicables** en todo el chat.
- **Instancia única**: relanzar la app devuelve la ventana existente.

---

## 12. Problemas de UX conocidos (a resolver en el rediseño)

1. **Header del chat sobrecargado**: modo de permisos, modelo, modelo de respaldo, parámetros, chip global, costo, actividad y detener, todo en una fila.
2. **Mezcla de emojis e iconos SVG** (📁 ⏺ 💬 🤖 📋 ✉ 🔐 ❓ …). Además hay iconos repetidos para cosas distintas: Ajustes y Acceso remoto comparten icono, igual que Actividad y Tareas.
3. **Dos sistemas de modal** (uno antiguo y otro del «UI Kit»), con anchos, cabeceras y pies distintos.
4. **Esc inconsistente**: algunos modales cierran con Esc y otros no. Algunos solo si el foco está dentro.
5. **Sin confirmaciones** en acciones destructivas: revocar dispositivos, cerrar pestañas.
6. **Sin estados de carga** en Acceso remoto y Tienda; sin feedback de validación en el formulario de snippets.
7. **Avisos del sistema pintados como mensajes del usuario** en el chat.
8. **Funciones poco descubribles**: snap de pestañas, emparejar widgets arrastrando, cola de mensajes, chat «Aparte», clic derecho en el chip de versión.
9. **Pestañas**: sin renombrar, reordenar ni menú contextual.
10. **Inconsistencia de catálogos**: la galería tiene 14 widgets y la Tienda lista 8.
11. **Hooks** se crean con un diálogo distinto (antiguo) al de agentes, comandos y skills.
12. En la paleta, Enter dentro del formulario de nuevo snippet ejecuta el snippet seleccionado de la lista, que está oculta.
13. **No hay toasts** para confirmar acciones («Agente creado», «MCP instalado»…).
14. **Falta indicador «↓ nuevos mensajes»** cuando el autoscroll está pausado.
15. **Toggles de permisos del plugin** que no tienen efecto real (son solo visuales).
