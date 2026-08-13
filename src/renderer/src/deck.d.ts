import type { DeckApi } from '../../preload/index'

declare global {
  interface Window {
    deck: DeckApi
  }
}

export {}
