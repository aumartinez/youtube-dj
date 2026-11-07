<script setup>
import { computed } from 'vue'
import { FADE_DURATIONS } from '../lib/crossfade'
import { autoFadeTriggerAt } from '../lib/autofade'
import { formatClock } from '../lib/youtube'
import { useMixer } from '../stores/mixer'

const mixer = useMixer()
const state = mixer.state

const otherSide = computed(() => (state.activeDeck === 'A' ? 'B' : 'A'))
const fadePercent = computed(() => Math.round(state.fade.progress * 100))

const buttonLabel = computed(() => {
  if (state.fade.active) {
    return `Cancel fade · ${state.fade.source} → ${state.fade.target} ${fadePercent.value}%`
  }
  return `Auto crossfade ${state.activeDeck} → ${otherSide.value}`
})

/* ---------- timed auto fade ---------- */

const autoFade = computed(() => state.settings.autoFade)

const liveDeckId = computed(() => {
  if (state.decks[state.activeDeck].playing) return state.activeDeck
  const other = state.activeDeck === 'A' ? 'B' : 'A'
  return state.decks[other].playing ? other : null
})

const liveItemId = computed(() => {
  const deckId = liveDeckId.value
  return deckId ? mixer.deckItem(deckId)?.id ?? null : null
})

const triggerValue = computed(() =>
  autoFade.value.mode === 'before-end'
    ? autoFade.value.secondsBeforeEnd
    : autoFade.value.atSeconds,
)

const autoFadeAt = computed(() => {
  const deckId = liveDeckId.value
  if (!deckId) return null
  return autoFadeTriggerAt(autoFade.value, state.decks[deckId].duration)
})

const autoFadeStatus = computed(() => {
  const settings = autoFade.value
  if (!settings.enabled) return 'Off. The button above stays manual.'
  if (!liveDeckId.value) return 'Waiting for a deck to play.'
  if (state.autoFadeRuntime.firedFor && state.autoFadeRuntime.firedFor === liveItemId.value) {
    return 'Cue already fired for this track.'
  }
  const at = autoFadeAt.value
  if (at === null) return 'Reading the track length…'
  if (settings.mode === 'before-end') {
    return `Fires at ${formatClock(at)} · ${settings.secondsBeforeEnd}s before the end`
  }
  return `Fires at ${formatClock(at)} of the track`
})

const autoFadeArmed = computed(
  () => autoFade.value.enabled && autoFadeAt.value !== null && liveItemId.value !== null,
)

function onModeChange(event) {
  mixer.setAutoFade({ mode: event.target.value })
}

function onTriggerInput(event) {
  const raw = event.target.value
  if (raw === '') return
  const field = autoFade.value.mode === 'before-end' ? 'secondsBeforeEnd' : 'atSeconds'
  mixer.setAutoFade({ [field]: raw })
}

function onFaderInput(event) {
  mixer.moveCrossfader(Number(event.target.value))
}
</script>

<template>
  <section class="mixer-panel" aria-label="Mixer controls">
    <header class="mixer-panel__head">
      <h2>Mixer</h2>
      <span class="mixer-panel__hint">{{ state.settings.fadeDuration }}s fade</span>
    </header>

    <div class="mixer-panel__group">
      <span class="mixer-panel__label">Fade duration</span>
      <div class="chips" role="group" aria-label="Fade duration">
        <button
          v-for="duration in FADE_DURATIONS"
          :key="duration"
          type="button"
          class="chip"
          :class="{ 'chip--on': state.settings.fadeDuration === duration }"
          :aria-pressed="state.settings.fadeDuration === duration"
          @click="mixer.setFadeDuration(duration)"
        >
          {{ duration }}s
        </button>
      </div>
    </div>

    <button
      type="button"
      class="btn btn--wide"
      :class="state.fade.active ? 'btn--danger' : 'btn--accent'"
      @click="mixer.autoCrossfade()"
    >
      {{ buttonLabel }}
    </button>

    <div
      v-if="state.fade.active"
      class="fade-bar"
      role="progressbar"
      :aria-valuenow="fadePercent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span :style="{ width: `${fadePercent}%` }"></span>
    </div>

    <div class="mixer-panel__group auto-fade">
      <div class="auto-fade__head">
        <span class="mixer-panel__label">Timed auto fade</span>
        <button
          type="button"
          class="switch"
          :class="{ 'switch--on': autoFade.enabled }"
          role="switch"
          :aria-checked="autoFade.enabled"
          @click="mixer.setAutoFade({ enabled: !autoFade.enabled })"
        >
          <span class="switch__dot" aria-hidden="true"></span>
          {{ autoFade.enabled ? 'On' : 'Off' }}
        </button>
      </div>

      <div class="auto-fade__row">
        <select
          class="auto-fade__select"
          :value="autoFade.mode"
          aria-label="Auto fade trigger mode"
          @change="onModeChange"
        >
          <option value="before-end">Before end</option>
          <option value="at-time">At track time</option>
        </select>
        <input
          class="auto-fade__number"
          type="number"
          min="1"
          max="3600"
          step="1"
          inputmode="numeric"
          :value="triggerValue"
          aria-label="Auto fade trigger in seconds"
          @input="onTriggerInput"
        />
      </div>

      <p class="auto-fade__status" :class="{ 'is-armed': autoFadeArmed }">
        {{ autoFadeStatus }}
      </p>
    </div>

    <div class="xfader">
      <label class="mixer-panel__label" for="crossfader">Crossfader</label>
      <input
        id="crossfader"
        class="xfader__input"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="state.crossfader"
        aria-valuetext="Deck A to Deck B mix"
        @input="onFaderInput"
      />
      <div class="xfader__labels">
        <span :class="{ 'is-loud': state.crossfader < 0.5 }">A {{ state.decks.A.volume }}%</span>
        <span :class="{ 'is-loud': state.crossfader >= 0.5 }">B {{ state.decks.B.volume }}%</span>
      </div>
    </div>

    <div class="mixer-panel__group">
      <span class="mixer-panel__label">Direction</span>
      <p class="mixer-panel__direction">
        Live deck <b>{{ state.activeDeck }}</b> → next <b>{{ otherSide }}</b>
      </p>
    </div>

    <p class="mixer-panel__foot">
      Auto crossfade snaps to the live deck, starts the other one, then interpolates both
      volumes. Timed auto fade runs the same fade by itself at the chosen cue point.
    </p>
  </section>
</template>
