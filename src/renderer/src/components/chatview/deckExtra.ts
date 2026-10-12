/**
 * APIs del puente que pueden no existir todavía en el tipo de `window.deck`
 * (las añade el main en paralelo). Se leen con un cast local y cada llamador
 * debe tolerar `undefined`: una versión del main sin ellas no debe romper el chat.
 */
export interface RewindResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

interface DeckExtra {
  chatRewindFiles?: (tabId: string, userMessageId: string, dryRun: boolean) => Promise<RewindResult>
  listProjectFiles?: (cwd: string, query: string) => Promise<string[]>
}

export function deckExtra(): DeckExtra {
  return window.deck as unknown as DeckExtra
}

/**
 * Ids que asigna la app y no el SDK: el eco provisional del envío y los avisos
 * de auto-compact/continuación. El SDK no los conoce, así que no sirven como
 * punto de rebobinado.
 */
const LOCAL_ID_PREFIXES = ['usuario-', 'auto-compact-', 'auto-cont-']

export function isLocalId(id: string): boolean {
  return LOCAL_ID_PREFIXES.some((p) => id.startsWith(p))
}

/** Avisos de la app pintados como mensaje de usuario (no son prompts reales) */
export function isNoticeId(id: string): boolean {
  return id.startsWith('auto-compact-') || id.startsWith('auto-cont-')
}
