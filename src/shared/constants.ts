/** Marcador que identifica los hooks instalados por claude-deck */
export const DECK_HOOK_MARKER = 'claude-deck-notify'

/** Puerto fijo del servidor local que recibe los eventos de los hooks */
export const DECK_PORT = 43117

/**
 * Carpeta donde `npm run dist` deja los instaladores. La app instalada la
 * revisa para ofrecer auto-actualización (editable en deck-state.json con la
 * clave updateDir si el proyecto se mueve de sitio).
 */
export const DEFAULT_UPDATE_DIR = 'C:\\Users\\jaldana\\Documents\\herramientas\\claude-deck\\release'
