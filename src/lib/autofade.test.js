import { describe, expect, it } from 'vitest'
import {
  AUTO_FADE_MODES,
  DEFAULT_AUTO_FADE,
  MAX_TRIGGER_SECONDS,
  MIN_TRIGGER_SECONDS,
  autoFadeTriggerAt,
  hasReachedAutoFadeTrigger,
  normalizeAutoFadeSettings,
} from './autofade'

describe('normalizeAutoFadeSettings', () => {
  it('defaults to disabled, before-end at 10 seconds', () => {
    expect(DEFAULT_AUTO_FADE).toEqual({
      enabled: false,
      mode: 'before-end',
      secondsBeforeEnd: 10,
      atSeconds: 60,
    })
    expect(normalizeAutoFadeSettings(undefined)).toEqual(DEFAULT_AUTO_FADE)
    expect(normalizeAutoFadeSettings(null)).toEqual(DEFAULT_AUTO_FADE)
  })

  it('keeps valid settings', () => {
    const settings = normalizeAutoFadeSettings({
      enabled: true,
      mode: 'at-time',
      secondsBeforeEnd: 22,
      atSeconds: 95,
    })
    expect(settings).toEqual({
      enabled: true,
      mode: 'at-time',
      secondsBeforeEnd: 22,
      atSeconds: 95,
    })
  })

  it('coerces string numbers and rejects unknown modes', () => {
    const settings = normalizeAutoFadeSettings({
      enabled: true,
      mode: 'sideways',
      secondsBeforeEnd: '15',
      atSeconds: '90',
    })
    expect(settings.mode).toBe(AUTO_FADE_MODES[0])
    expect(settings.secondsBeforeEnd).toBe(15)
    expect(settings.atSeconds).toBe(90)
    expect(settings.enabled).toBe(true)
  })

  it('clamps trigger values into a sane range', () => {
    const low = normalizeAutoFadeSettings({ secondsBeforeEnd: 0, atSeconds: -40 })
    expect(low.secondsBeforeEnd).toBe(MIN_TRIGGER_SECONDS)
    expect(low.atSeconds).toBe(MIN_TRIGGER_SECONDS)

    const high = normalizeAutoFadeSettings({ secondsBeforeEnd: 99999, atSeconds: 99999 })
    expect(high.secondsBeforeEnd).toBe(MAX_TRIGGER_SECONDS)
    expect(high.atSeconds).toBe(MAX_TRIGGER_SECONDS)
  })

  it('only treats a real boolean true as enabled', () => {
    expect(normalizeAutoFadeSettings({ enabled: 'yes' }).enabled).toBe(false)
    expect(normalizeAutoFadeSettings({ enabled: 1 }).enabled).toBe(false)
    expect(normalizeAutoFadeSettings({ enabled: true }).enabled).toBe(true)
  })
})

describe('autoFadeTriggerAt', () => {
  const beforeEnd = normalizeAutoFadeSettings({ mode: 'before-end', secondsBeforeEnd: 15 })
  const atTime = normalizeAutoFadeSettings({ mode: 'at-time', atSeconds: 60 })

  it('counts back from the end for before-end mode', () => {
    expect(autoFadeTriggerAt(beforeEnd, 200)).toBe(185)
    expect(autoFadeTriggerAt(beforeEnd, 16)).toBe(1)
  })

  it('returns the absolute timestamp for at-time mode', () => {
    expect(autoFadeTriggerAt(atTime, 200)).toBe(60)
  })

  it('never fires before the track length is known', () => {
    expect(autoFadeTriggerAt(beforeEnd, 0)).toBeNull()
    expect(autoFadeTriggerAt(beforeEnd, undefined)).toBeNull()
    expect(autoFadeTriggerAt(atTime, NaN)).toBeNull()
  })

  it('clamps a before-end trigger to the start of very short tracks', () => {
    expect(autoFadeTriggerAt(beforeEnd, 5)).toBe(0)
  })
})

describe('hasReachedAutoFadeTrigger', () => {
  const beforeEnd = normalizeAutoFadeSettings({ mode: 'before-end', secondsBeforeEnd: 4 })
  const atTime = normalizeAutoFadeSettings({ mode: 'at-time', atSeconds: 60 })

  it('fires once playback passes the before-end cue', () => {
    expect(
      hasReachedAutoFadeTrigger({ settings: beforeEnd, currentTime: 95.9, duration: 100 }),
    ).toBe(false)
    expect(
      hasReachedAutoFadeTrigger({ settings: beforeEnd, currentTime: 96, duration: 100 }),
    ).toBe(true)
    expect(
      hasReachedAutoFadeTrigger({ settings: beforeEnd, currentTime: 99, duration: 100 }),
    ).toBe(true)
  })

  it('fires once playback passes the absolute timestamp', () => {
    expect(hasReachedAutoFadeTrigger({ settings: atTime, currentTime: 59.5, duration: 300 })).toBe(
      false,
    )
    expect(hasReachedAutoFadeTrigger({ settings: atTime, currentTime: 60, duration: 300 })).toBe(true)
  })

  it('never fires at time zero or without a duration', () => {
    expect(hasReachedAutoFadeTrigger({ settings: beforeEnd, currentTime: 0, duration: 100 })).toBe(
      false,
    )
    expect(hasReachedAutoFadeTrigger({ settings: atTime, currentTime: 0, duration: 300 })).toBe(false)
    expect(hasReachedAutoFadeTrigger({ settings: beforeEnd, currentTime: 50, duration: 0 })).toBe(
      false,
    )
  })

  it('never fires when the timestamp is at or past the end', () => {
    expect(hasReachedAutoFadeTrigger({ settings: atTime, currentTime: 120, duration: 60 })).toBe(
      false,
    )
  })
})
