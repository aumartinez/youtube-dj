/**
 * Timed auto fade ("auto DJ") trigger logic.
 *
 * Two ways to pick the cue point:
 *   before-end -> starts when the track has N seconds left
 *   at-time    -> starts when the playhead reaches an absolute timestamp
 *
 * Pure functions only; the store polls the player clock and fires the existing
 * crossfade engine exactly once per track, per cue.
 */

export const AUTO_FADE_MODES = Object.freeze(['before-end', 'at-time'])
export const MIN_TRIGGER_SECONDS = 1
export const MAX_TRIGGER_SECONDS = 3600

export const DEFAULT_AUTO_FADE = Object.freeze({
  enabled: false,
  mode: 'before-end',
  secondsBeforeEnd: 10,
  atSeconds: 60,
})

function normalizeSeconds(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(MAX_TRIGGER_SECONDS, Math.max(MIN_TRIGGER_SECONDS, Math.round(number)))
}

export function normalizeAutoFadeSettings(input) {
  const source = input && typeof input === 'object' ? input : {}

  return {
    enabled: source.enabled === true,
    mode: AUTO_FADE_MODES.includes(source.mode) ? source.mode : DEFAULT_AUTO_FADE.mode,
    secondsBeforeEnd: normalizeSeconds(source.secondsBeforeEnd, DEFAULT_AUTO_FADE.secondsBeforeEnd),
    atSeconds: normalizeSeconds(source.atSeconds, DEFAULT_AUTO_FADE.atSeconds),
  }
}

/** Absolute playhead position (seconds) where the fade should start, or null. */
export function autoFadeTriggerAt(settings, duration) {
  const safe = normalizeAutoFadeSettings(settings)
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (safe.mode === 'at-time') return safe.atSeconds
  return Math.max(0, duration - safe.secondsBeforeEnd)
}

export function hasReachedAutoFadeTrigger({ settings, currentTime, duration } = {}) {
  const safe = normalizeAutoFadeSettings(settings)
  const trigger = autoFadeTriggerAt(safe, duration)

  if (trigger === null) return false
  if (!Number.isFinite(currentTime) || currentTime <= 0) return false
  // An absolute timestamp at or past the end can never be reached.
  if (safe.mode === 'at-time' && safe.atSeconds >= duration) return false

  return currentTime >= trigger
}
