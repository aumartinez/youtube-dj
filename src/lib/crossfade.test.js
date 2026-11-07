import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FADE_DURATION,
  FADE_DURATIONS,
  crossfaderToSide,
  crossfaderVolumes,
  fadeValueAt,
  normalizeFadeDuration,
  runFade,
  sideToCrossfader,
} from './crossfade'

function createFrameClock() {
  return {
    time: 0,
    queue: [],
    now() {
      return this.time
    },
    requestFrame(callback) {
      this.queue.push(callback)
      return this.queue.length
    },
    cancelFrame() {
      this.queue = []
    },
    run(ms) {
      this.time += ms
      const due = this.queue
      this.queue = []
      for (const callback of due) callback(this.time)
    },
  }
}

describe('fade durations', () => {
  it('offers 4, 8, 12 and 16 seconds', () => {
    expect(FADE_DURATIONS).toEqual([4, 8, 12, 16])
    expect(DEFAULT_FADE_DURATION).toBe(8)
  })

  it('normalizes unknown values to the default', () => {
    expect(normalizeFadeDuration(12)).toBe(12)
    expect(normalizeFadeDuration('16')).toBe(16)
    expect(normalizeFadeDuration(7)).toBe(DEFAULT_FADE_DURATION)
    expect(normalizeFadeDuration(undefined)).toBe(DEFAULT_FADE_DURATION)
  })
})

describe('crossfaderVolumes', () => {
  it('gives deck A full volume at the A side', () => {
    expect(crossfaderVolumes(0)).toEqual({ A: 100, B: 0 })
  })

  it('gives deck B full volume at the B side', () => {
    expect(crossfaderVolumes(1)).toEqual({ A: 0, B: 100 })
  })

  it('mixes linearly in the middle', () => {
    expect(crossfaderVolumes(0.5)).toEqual({ A: 50, B: 50 })
    expect(crossfaderVolumes(0.25)).toEqual({ A: 75, B: 25 })
  })

  it('clamps out of range values', () => {
    expect(crossfaderVolumes(-2)).toEqual({ A: 100, B: 0 })
    expect(crossfaderVolumes(9)).toEqual({ A: 0, B: 100 })
    expect(crossfaderVolumes(NaN)).toEqual({ A: 100, B: 0 })
  })
})

describe('side helpers', () => {
  it('maps decks to crossfader ends', () => {
    expect(sideToCrossfader('A')).toBe(0)
    expect(sideToCrossfader('B')).toBe(1)
  })

  it('maps the crossfader position to the loudest side', () => {
    expect(crossfaderToSide(0.2)).toBe('A')
    expect(crossfaderToSide(0.49)).toBe('A')
    expect(crossfaderToSide(0.5)).toBe('B')
    expect(crossfaderToSide(0.9)).toBe('B')
  })
})

describe('fadeValueAt', () => {
  it('interpolates between the endpoints', () => {
    expect(fadeValueAt(0, 1, 0)).toBe(0)
    expect(fadeValueAt(0, 1, 0.5)).toBe(0.5)
    expect(fadeValueAt(0, 1, 1)).toBe(1)
    expect(fadeValueAt(1, 0, 0.25)).toBe(0.75)
  })

  it('clamps progress', () => {
    expect(fadeValueAt(0, 1, -1)).toBe(0)
    expect(fadeValueAt(0, 1, 3)).toBe(1)
  })
})

describe('runFade', () => {
  it('drives volume interpolation with frames over the selected duration', () => {
    const clock = createFrameClock()
    const onUpdate = vi.fn()
    const onDone = vi.fn()

    runFade({
      from: 0,
      to: 1,
      durationMs: 4000,
      now: () => clock.now(),
      requestFrame: (cb) => clock.requestFrame(cb),
      cancelFrame: (id) => clock.cancelFrame(id),
      onUpdate,
      onDone,
    })

    clock.run(0)
    expect(onUpdate).toHaveBeenLastCalledWith(0, 0)

    clock.run(1000)
    expect(onUpdate).toHaveBeenLastCalledWith(0.25, 0.25)

    clock.run(2000)
    expect(onUpdate).toHaveBeenLastCalledWith(0.75, 0.75)

    clock.run(1000)
    expect(onUpdate).toHaveBeenLastCalledWith(1, 1)
    expect(onDone).toHaveBeenCalledTimes(1)

    clock.run(4000)
    expect(onUpdate).toHaveBeenCalledTimes(4)
  })

  it('runs the opposite direction for a B to A fade', () => {
    const clock = createFrameClock()
    const values = []
    runFade({
      from: 1,
      to: 0,
      durationMs: 1000,
      now: () => clock.now(),
      requestFrame: (cb) => clock.requestFrame(cb),
      cancelFrame: () => {},
      onUpdate: (value) => values.push(value),
      onDone: () => {},
    })
    clock.run(0)
    clock.run(500)
    clock.run(500)
    expect(values).toEqual([1, 0.5, 0])
  })

  it('stops emitting after cancel', () => {
    const clock = createFrameClock()
    const onUpdate = vi.fn()
    const handle = runFade({
      from: 0,
      to: 1,
      durationMs: 1000,
      now: () => clock.now(),
      requestFrame: (cb) => clock.requestFrame(cb),
      cancelFrame: (id) => clock.cancelFrame(id),
      onUpdate,
      onDone: () => {},
    })
    clock.run(0)
    handle.cancel()
    clock.run(500)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
