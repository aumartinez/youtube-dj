import { describe, expect, it } from 'vitest'
import { ITEM_STATES } from './playlist'
import { STORAGE_KEY, parseStoredState, serializeState } from './storage'

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'

function sampleState() {
  return {
    items: [
      {
        id: 'item-1',
        videoId: VIDEO_A,
        title: 'First',
        state: ITEM_STATES.PLAYING,
        deck: 'A',
        addedAt: 1,
        error: null,
      },
      {
        id: 'item-2',
        videoId: VIDEO_B,
        title: 'Second',
        state: ITEM_STATES.QUEUED,
        deck: null,
        addedAt: 2,
        error: null,
      },
    ],
    settings: { fadeDuration: 12 },
    crossfader: 0.75,
  }
}

describe('serializeState', () => {
  it('keeps order, assignments and settings', () => {
    const saved = serializeState(sampleState())
    expect(saved.version).toBe(1)
    expect(saved.items.map((item) => item.id)).toEqual(['item-1', 'item-2'])
    expect(saved.settings.fadeDuration).toBe(12)
    expect(saved.crossfader).toBe(0.75)
  })

  it('normalizes invalid settings instead of persisting them', () => {
    const saved = serializeState({ items: [], settings: { fadeDuration: 99 }, crossfader: 5 })
    expect(saved.settings.fadeDuration).toBe(8)
    expect(saved.crossfader).toBe(1)
  })
})

describe('parseStoredState', () => {
  it('round-trips a serialized state', () => {
    const parsed = parseStoredState(JSON.stringify(serializeState(sampleState())))
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0].state).toBe(ITEM_STATES.LOADED)
    expect(parsed.items[0].deck).toBe('A')
    expect(parsed.crossfader).toBe(0.75)
    expect(parsed.settings.fadeDuration).toBe(12)
  })

  it('never restores a playing item as playing (no autoplay)', () => {
    const parsed = parseStoredState(serializeState(sampleState()))
    expect(parsed.items.some((item) => item.state === ITEM_STATES.PLAYING)).toBe(false)
  })

  it('returns null for empty or corrupt payloads', () => {
    expect(parseStoredState(null)).toBeNull()
    expect(parseStoredState('')).toBeNull()
    expect(parseStoredState('{not json')).toBeNull()
    expect(parseStoredState('"text"')).toBeNull()
  })

  it('drops items with invalid video ids', () => {
    const parsed = parseStoredState(
      JSON.stringify({ version: 1, items: [{ id: 'x', videoId: 'nope', state: 'queued' }] }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed.items).toEqual([])
  })

  it('deduplicates deck assignments and drops orphaned ones', () => {
    const parsed = parseStoredState(
      JSON.stringify({
        version: 1,
        items: [
          { id: 'a', videoId: VIDEO_A, state: 'loaded', deck: 'A', title: 'A' },
          { id: 'b', videoId: VIDEO_B, state: 'loaded', deck: 'A', title: 'B' },
          { id: 'c', videoId: 'ccccccccccc', state: 'loaded', deck: null, title: 'C' },
        ],
      }),
    )
    expect(parsed.items[0].deck).toBe('A')
    expect(parsed.items[1].deck).toBeNull()
    expect(parsed.items[1].state).toBe(ITEM_STATES.QUEUED)
    expect(parsed.items[2].deck).toBeNull()
    expect(parsed.items[2].state).toBe(ITEM_STATES.QUEUED)
  })

  it('drops duplicate ids and coerces unknown states to queued', () => {
    const parsed = parseStoredState(
      JSON.stringify({
        version: 1,
        items: [
          { id: 'same', videoId: VIDEO_A, state: 'weird', deck: 'A' },
          { id: 'same', videoId: VIDEO_B, state: 'played', deck: null },
        ],
      }),
    )
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].state).toBe(ITEM_STATES.QUEUED)
  })

  it('falls back to a stable title and timestamp', () => {
    const parsed = parseStoredState(
      JSON.stringify({ items: [{ id: 'x', videoId: VIDEO_A, state: 'queued' }] }),
    )
    expect(parsed.items[0].title).toContain(VIDEO_A)
    expect(typeof parsed.items[0].addedAt).toBe('number')
  })

  it('persists and sanitizes the timed auto fade settings', () => {
    const saved = serializeState({
      items: [],
      settings: {
        fadeDuration: 8,
        autoFade: { enabled: true, mode: 'at-time', secondsBeforeEnd: 5, atSeconds: 90 },
      },
      crossfader: 0,
    })
    expect(saved.settings.autoFade).toEqual({
      enabled: true,
      mode: 'at-time',
      secondsBeforeEnd: 5,
      atSeconds: 90,
    })

    const parsed = parseStoredState(JSON.stringify(saved))
    expect(parsed.settings.autoFade.enabled).toBe(true)
    expect(parsed.settings.autoFade.mode).toBe('at-time')
    expect(parsed.settings.autoFade.atSeconds).toBe(90)
  })

  it('replaces invalid auto fade settings with safe defaults', () => {
    const parsed = parseStoredState(
      JSON.stringify({
        items: [],
        settings: { autoFade: { enabled: 'yes', mode: 'nope', secondsBeforeEnd: 0, atSeconds: -4 } },
      }),
    )
    expect(parsed.settings.autoFade).toEqual({
      enabled: false,
      mode: 'before-end',
      secondsBeforeEnd: 1,
      atSeconds: 1,
    })
  })

  it('persists and defaults the repeat-list flag', () => {
    const saved = serializeState({ items: [], settings: { repeatList: true }, crossfader: 0 })
    expect(saved.settings.repeatList).toBe(true)
    expect(parseStoredState(JSON.stringify(saved)).settings.repeatList).toBe(true)
    expect(parseStoredState(JSON.stringify({ items: [], settings: {} })).settings.repeatList).toBe(
      false,
    )
  })

  it('persists and defaults the shuffle flag', () => {
    const saved = serializeState({ items: [], settings: { shuffle: true }, crossfader: 0 })
    expect(saved.settings.shuffle).toBe(true)
    expect(parseStoredState(JSON.stringify(saved)).settings.shuffle).toBe(true)
    expect(parseStoredState(JSON.stringify({ items: [], settings: {} })).settings.shuffle).toBe(
      false,
    )
  })

  it('exposes a versioned storage key', () => {
    expect(STORAGE_KEY).toBe('youtube-dj-mixer:v1')
  })
})
