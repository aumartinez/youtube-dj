/**
 * localStorage persistence.
 *
 * Restoring is deliberately conservative: a `playing` item comes back as
 * `loaded`, so a page reload can never autoplay audio. Only `loaded` items
 * keep a deck; everything else is sanitized back into the queue.
 */

import { clamp01, normalizeFadeDuration } from './crossfade'
import { normalizeAutoFadeSettings } from './autofade'
import { ITEM_STATES, ITEM_STATE_VALUES } from './playlist'
import { isVideoId } from './youtube'

export const STORAGE_KEY = 'youtube-dj-mixer:v1'
export const STORAGE_VERSION = 1

const MAX_ITEMS = 200
const DECK_IDS = new Set(['A', 'B'])

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Storage can be blocked (private mode, denied permission).
  }
  return null
}

export function serializeState({ items = [], settings = {}, crossfader = 0 } = {}) {
  return {
    version: STORAGE_VERSION,
    savedAt: Date.now(),
    items: items.map((item) => ({
      id: item.id,
      videoId: item.videoId,
      title: item.title,
      state: item.state,
      deck: item.deck ?? null,
      addedAt: item.addedAt ?? 0,
      error: item.error ?? null,
    })),
    settings: {
      fadeDuration: normalizeFadeDuration(settings?.fadeDuration),
      autoFade: normalizeAutoFadeSettings(settings?.autoFade),
      repeatList: settings?.repeatList === true,
    },
    crossfader: clamp01(crossfader),
  }
}

/** Accepts a raw JSON string or an already-parsed payload (useful for tests and migrations). */
export function parseStoredState(raw) {
  let data
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  } else if (raw && typeof raw === 'object') {
    data = raw
  } else {
    return null
  }
  if (typeof data !== 'object' || Array.isArray(data)) return null

  const items = []
  const usedIds = new Set()
  const usedDecks = new Set()
  const source = Array.isArray(data.items) ? data.items.slice(0, MAX_ITEMS) : []

  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue

    const videoId = typeof candidate.videoId === 'string' ? candidate.videoId.trim() : ''
    if (!isVideoId(videoId)) continue

    const id =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `restored-${items.length}-${videoId}`
    if (usedIds.has(id)) continue

    let state = ITEM_STATE_VALUES.includes(candidate.state)
      ? candidate.state
      : ITEM_STATES.QUEUED
    let deck = DECK_IDS.has(candidate.deck) ? candidate.deck : null

    // Never resume audio after a reload.
    if (state === ITEM_STATES.PLAYING) state = ITEM_STATES.LOADED
    // Only a loaded (cued, silent) item may hold a deck.
    if (state !== ITEM_STATES.LOADED) deck = null
    if (state === ITEM_STATES.LOADED && (!deck || usedDecks.has(deck))) {
      state = ITEM_STATES.QUEUED
      deck = null
    }
    if (deck) usedDecks.add(deck)

    usedIds.add(id)
    items.push({
      id,
      videoId,
      title:
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : `YouTube video ${videoId}`,
      state,
      deck,
      addedAt: Number.isFinite(candidate.addedAt) ? candidate.addedAt : Date.now(),
      error: null,
    })
  }

  return {
    items,
    settings: {
      fadeDuration: normalizeFadeDuration(data.settings?.fadeDuration),
      autoFade: normalizeAutoFadeSettings(data.settings?.autoFade),
      repeatList: data.settings?.repeatList === true,
    },
    crossfader: clamp01(data.crossfader),
  }
}

export function loadPersistedState(storage = safeStorage()) {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const parsed = parseStoredState(raw)
    if (!parsed) return null
    return parsed
  } catch {
    return null
  }
}

export function savePersistedState(payload, storage = safeStorage()) {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearPersistedState(storage = safeStorage()) {
  if (!storage) return false
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
