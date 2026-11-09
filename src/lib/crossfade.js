/**
 * Crossfade math and the requestAnimationFrame runner.
 *
 * The crossfader position is the single source of truth for both deck
 * volumes: 0 = Deck A at 100% / Deck B at 0%, 1 = the opposite.
 * Auto crossfade animates that position, which linearly interpolates the
 * two volumes over the selected duration.
 */

export const FADE_DURATIONS = [4, 8, 12, 16]
export const DEFAULT_FADE_DURATION = 8

export function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(1, Math.max(0, number))
}

export function normalizeFadeDuration(value) {
  const number = Number(value)
  return FADE_DURATIONS.includes(number) ? number : DEFAULT_FADE_DURATION
}

/** position -> { A, B } volumes in the 0..100 range used by YT.Player.setVolume */
export function crossfaderVolumes(position) {
  const p = clamp01(position)
  return {
    A: Math.round((1 - p) * 100),
    B: Math.round(p * 100),
  }
}

export function sideToCrossfader(deckId) {
  return deckId === 'B' ? 1 : 0
}

export function crossfaderToSide(position) {
  return clamp01(position) >= 0.5 ? 'B' : 'A'
}

/**
 * The deck a crossfade should fade out of: the one the listener actually
 * hears. Both decks can be playing at once — for example after pressing Play
 * on the silent deck — so the louder side of the crossfader wins over the
 * active deck. Returns null when neither deck plays.
 */
export function crossfadeSourceDeck({ activeDeck = 'A', crossfader = 0, decks = {} } = {}) {
  const playingA = Boolean(decks.A?.playing)
  const playingB = Boolean(decks.B?.playing)

  if (playingA && playingB) {
    const volumes = crossfaderVolumes(crossfader)
    if (volumes.A === volumes.B) return activeDeck === 'B' ? 'B' : 'A'
    return volumes.A > volumes.B ? 'A' : 'B'
  }
  if (playingA) return 'A'
  if (playingB) return 'B'
  return null
}

export function fadeValueAt(startValue, targetValue, progress) {
  const p = clamp01(progress)
  return startValue + (targetValue - startValue) * p
}

/**
 * Drives a fade with requestAnimationFrame. The clock and the frame
 * scheduler are injected so the behavior is deterministic in tests.
 *
 * `watchdogMs` adds a fallback driver for hidden tabs, where browsers stop
 * rAF entirely: if no frame arrived within that window, the watchdog steps the
 * fade itself. Progress is derived from elapsed time, so the fade still lands
 * on schedule with coarse steps.
 * Returns a handle with `cancel()`.
 */
export function runFade({
  from,
  to,
  durationMs,
  now,
  requestFrame,
  cancelFrame,
  onUpdate,
  onDone,
  watchdogMs = 0,
  setIntervalFn,
  clearIntervalFn,
}) {
  const startedAt = now()
  let frameId = null
  let watchdogId = null
  let lastTick = startedAt
  let finished = false
  let cancelled = false

  const stopWatchdog = () => {
    if (watchdogId !== null) {
      clearIntervalFn?.(watchdogId)
      watchdogId = null
    }
  }

  const step = (viaWatchdog) => {
    if (cancelled || finished) return
    const elapsed = now() - startedAt
    const progress = durationMs <= 0 ? 1 : clamp01(elapsed / durationMs)
    lastTick = now()
    onUpdate?.(fadeValueAt(from, to, progress), progress)

    if (progress >= 1) {
      finished = true
      stopWatchdog()
      onDone?.()
      return
    }

    if (!viaWatchdog) {
      frameId = requestFrame(frame)
    }
  }

  const frame = () => step(false)

  frameId = requestFrame(frame)

  if (watchdogMs > 0 && typeof setIntervalFn === 'function') {
    watchdogId = setIntervalFn(() => {
      if (cancelled || finished) return
      if (now() - lastTick < watchdogMs) return
      step(true)
    }, watchdogMs)
  }

  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      if (frameId !== null) cancelFrame?.(frameId)
      stopWatchdog()
    },
  }
}
