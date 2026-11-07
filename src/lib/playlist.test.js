import { describe, expect, it } from 'vitest'
import {
  ITEM_STATES,
  assignItemToDeck,
  countByState,
  createPlaylistItem,
  deckItem,
  findNextQueued,
  markPlayed,
  releaseItem,
  reorderItems,
} from './playlist'

const VID = (n) => `vid${String(n).padStart(8, '0')}`.slice(0, 11)

function buildList(count) {
  return Array.from({ length: count }, (_, index) =>
    createPlaylistItem({ videoId: VID(index), title: `Track ${index}`, id: `item-${index}` }),
  )
}

describe('createPlaylistItem', () => {
  it('creates a queued item with no deck', () => {
    const item = createPlaylistItem({ videoId: VID(1), title: 'Track' })
    expect(item.state).toBe(ITEM_STATES.QUEUED)
    expect(item.deck).toBeNull()
    expect(item.error).toBeNull()
    expect(item.id).toBeTruthy()
  })

  it('never reuses a generated id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createPlaylistItem({ videoId: VID(1) }).id))
    expect(ids.size).toBe(50)
  })
})

describe('findNextQueued', () => {
  it('returns the first queued item and skips assigned or played ones', () => {
    const items = buildList(4)
    assignItemToDeck(items, 'item-0', 'A')
    assignItemToDeck(items, 'item-1', 'B')
    markPlayed(items, 'item-2')
    expect(findNextQueued(items)?.id).toBe('item-3')
  })

  it('returns null when nothing is queued', () => {
    expect(findNextQueued([])).toBeNull()
    expect(findNextQueued([{ id: 'x', state: ITEM_STATES.PLAYED, deck: null }])).toBeNull()
  })
})

describe('deck assignment', () => {
  it('assigns an item to a deck and marks it loaded', () => {
    const items = buildList(2)
    const assigned = assignItemToDeck(items, 'item-0', 'A')
    expect(assigned.state).toBe(ITEM_STATES.LOADED)
    expect(assigned.deck).toBe('A')
    expect(deckItem(items, 'A')?.id).toBe('item-0')
    expect(deckItem(items, 'B')).toBeNull()
  })

  it('never lets one item sit on two decks', () => {
    const items = buildList(2)
    assignItemToDeck(items, 'item-0', 'A')
    assignItemToDeck(items, 'item-0', 'B')
    expect(deckItem(items, 'A')).toBeNull()
    expect(deckItem(items, 'B')?.id).toBe('item-0')
    expect(items[0].deck).toBe('B')
  })

  it('returns the previous deck item to the queue when a deck takes a new one', () => {
    const items = buildList(2)
    assignItemToDeck(items, 'item-0', 'A')
    assignItemToDeck(items, 'item-1', 'A')
    expect(items[0].state).toBe(ITEM_STATES.QUEUED)
    expect(items[0].deck).toBeNull()
    expect(deckItem(items, 'A')?.id).toBe('item-1')
  })

  it('does not disturb the other deck', () => {
    const items = buildList(3)
    assignItemToDeck(items, 'item-0', 'A')
    assignItemToDeck(items, 'item-1', 'B')
    assignItemToDeck(items, 'item-2', 'A')
    expect(deckItem(items, 'B')?.id).toBe('item-1')
  })
})

describe('release and played', () => {
  it('releases an item back to the queue without leaving a deck behind', () => {
    const items = buildList(1)
    assignItemToDeck(items, 'item-0', 'A')
    const released = releaseItem(items, 'item-0')
    expect(released.state).toBe(ITEM_STATES.QUEUED)
    expect(released.deck).toBeNull()
    expect(deckItem(items, 'A')).toBeNull()
  })

  it('marks an item played and drops its deck', () => {
    const items = buildList(1)
    assignItemToDeck(items, 'item-0', 'B')
    const item = markPlayed(items, 'item-0')
    expect(item.state).toBe(ITEM_STATES.PLAYED)
    expect(item.deck).toBeNull()
    expect(deckItem(items, 'B')).toBeNull()
  })
})

describe('reorderItems', () => {
  it('moves an item forward without touching states or deck ids', () => {
    const items = buildList(3)
    assignItemToDeck(items, 'item-0', 'A')
    reorderItems(items, 0, 2)
    expect(items.map((item) => item.id)).toEqual(['item-1', 'item-2', 'item-0'])
    expect(deckItem(items, 'A')?.id).toBe('item-0')
    expect(deckItem(items, 'A')?.state).toBe(ITEM_STATES.LOADED)
  })

  it('moves an item backward', () => {
    const items = buildList(3)
    reorderItems(items, 2, 0)
    expect(items.map((item) => item.id)).toEqual(['item-2', 'item-0', 'item-1'])
  })

  it('ignores out of range indexes', () => {
    const items = buildList(2)
    reorderItems(items, 5, 0)
    expect(items.map((item) => item.id)).toEqual(['item-0', 'item-1'])
  })
})

describe('countByState', () => {
  it('counts every state including empty ones', () => {
    const items = buildList(3)
    assignItemToDeck(items, 'item-0', 'A')
    items[0].state = ITEM_STATES.PLAYING
    markPlayed(items, 'item-1')
    expect(countByState(items)).toEqual({ queued: 1, loaded: 0, playing: 1, played: 1 })
  })
})
