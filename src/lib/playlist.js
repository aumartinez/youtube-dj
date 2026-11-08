/**
 * Playlist state machine.
 *
 * Item states:
 *   queued  -> waiting in the list, owned by nobody
 *   loaded  -> cued on a deck, not playing
 *   playing -> assigned to a deck and currently playing
 *   played  -> consumed (finished, ejected or skipped), never auto-assigned again
 *
 * Deck ownership lives on the item (`item.deck`), so reordering the array can
 * never interrupt a track that is already loaded or playing.
 */

export const ITEM_STATES = Object.freeze({
  QUEUED: 'queued',
  LOADED: 'loaded',
  PLAYING: 'playing',
  PLAYED: 'played',
})

export const ITEM_STATE_VALUES = Object.freeze(Object.values(ITEM_STATES))

const ACTIVE_STATES = new Set([ITEM_STATES.LOADED, ITEM_STATES.PLAYING])

let sequence = 0

export function createItemId() {
  sequence += 1
  return `track-${Date.now().toString(36)}-${sequence.toString(36)}`
}

export function createPlaylistItem({ videoId, title = '', id, now = Date.now() } = {}) {
  return {
    id: id ?? createItemId(),
    videoId,
    title: title || `YouTube video ${videoId}`,
    state: ITEM_STATES.QUEUED,
    deck: null,
    addedAt: now,
    error: null,
  }
}

export function isAssigned(item) {
  return Boolean(item) && ACTIVE_STATES.has(item.state) && (item.deck === 'A' || item.deck === 'B')
}

/** The single item a deck currently owns, derived from the list (never duplicated). */
export function deckItem(items, deckId) {
  return items.find((item) => item.deck === deckId && ACTIVE_STATES.has(item.state)) ?? null
}

/** First upcoming item that is not owned by any deck. */
export function findNextQueued(items) {
  return items.find((item) => item.state === ITEM_STATES.QUEUED) ?? null
}

/**
 * Assigns an item to a deck, releasing whatever that deck owned before.
 * An item can only ever point at one deck, so duplicate assignment is impossible.
 */
export function assignItemToDeck(items, itemId, deckId) {
  const target = items.find((item) => item.id === itemId)
  if (!target) return null

  for (const item of items) {
    if (item !== target && item.deck === deckId && ACTIVE_STATES.has(item.state)) {
      item.deck = null
      item.state = ITEM_STATES.QUEUED
      item.error = null
    }
  }

  target.deck = deckId
  target.state = ITEM_STATES.LOADED
  target.error = null
  return target
}

/** Frees an item from its deck. Defaults to sending it back to the queue. */
export function releaseItem(items, itemId, nextState = ITEM_STATES.QUEUED) {
  const item = items.find((entry) => entry.id === itemId)
  if (!item) return null
  item.deck = null
  item.state = nextState
  return item
}

export function markPlayed(items, itemId) {
  const item = items.find((entry) => entry.id === itemId)
  if (!item) return null
  item.deck = null
  item.state = ITEM_STATES.PLAYED
  return item
}

/** Puts every consumed track back in the queue, preserving list order. */
export function requeuePlayed(items) {
  let count = 0
  for (const item of items) {
    if (item.state === ITEM_STATES.PLAYED) {
      item.state = ITEM_STATES.QUEUED
      item.deck = null
      item.error = null
      count += 1
    }
  }
  return count
}

/** In-place reorder used by drag-and-drop. States and deck ids are untouched. */
export function reorderItems(items, fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return items
  if (fromIndex < 0 || fromIndex >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, toIndex))
  const [moved] = items.splice(fromIndex, 1)
  items.splice(target, 0, moved)
  return items
}

export function countByState(items) {
  const counts = { queued: 0, loaded: 0, playing: 0, played: 0 }
  for (const item of items) {
    if (counts[item.state] !== undefined) counts[item.state] += 1
  }
  return counts
}
