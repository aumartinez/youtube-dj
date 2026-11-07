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

export function fadeValueAt(startValue, targetValue, progress) {
  const p = clamp01(progress)
  return startValue + (targetValue - startValue) * p
}

/**
 * Drives a fade with requestAnimationFrame. The clock and the frame
 * scheduler are injected so the behavior is deterministic in tests.
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
}) {
  const startedAt = now()
  let frameId = null
  let cancelled = false

  const step = () => {
    if (cancelled) return
    const elapsed = now() - startedAt
    const progress = durationMs <= 0 ? 1 : clamp01(elapsed / durationMs)
    onUpdate?.(fadeValueAt(from, to, progress), progress)

    if (progress < 1) {
      frameId = requestFrame(step)
    } else {
      onDone?.()
    }
  }

  frameId = requestFrame(step)

  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      if (frameId !== null) cancelFrame?.(frameId)
    },
  }
}
