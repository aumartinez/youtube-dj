<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatClock } from '../lib/youtube'
import { useMixer } from '../stores/mixer'

const props = defineProps({
  deckId: { type: String, required: true },
})

const mixer = useMixer()
const frame = ref(null)
const scrubRatio = ref(null)

const deck = computed(() => mixer.state.decks[props.deckId])
const item = computed(() => mixer.deckItem(props.deckId))
const isActive = computed(() => mixer.state.activeDeck === props.deckId && deck.value.playing)
const progress = computed(() => {
  if (!deck.value.duration) return 0
  return Math.min(100, Math.max(0, (deck.value.currentTime / deck.value.duration) * 100))
})
const stateLabel = computed(() => item.value?.state ?? 'empty')
const queueEmpty = computed(() => mixer.state.items.length === 0)

const displayProgress = computed(() =>
  scrubRatio.value !== null ? scrubRatio.value * 100 : progress.value,
)

const displayTime = computed(() =>
  scrubRatio.value !== null
    ? formatClock(scrubRatio.value * deck.value.duration)
    : formatClock(deck.value.currentTime),
)

function ratioFromPointer(event) {
  const rect = event.currentTarget?.getBoundingClientRect?.()
  if (!rect || !rect.width) return 0
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
}

function startScrub(event) {
  if (!(deck.value.duration > 0)) return
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  } catch {
    /* jsdom and old browsers */
  }
  scrubRatio.value = ratioFromPointer(event)
}

function moveScrub(event) {
  if (scrubRatio.value === null) return
  scrubRatio.value = ratioFromPointer(event)
}

function endScrub() {
  if (scrubRatio.value === null) return
  const ratio = scrubRatio.value
  scrubRatio.value = null
  mixer.seekDeck(props.deckId, ratio * deck.value.duration)
}

function onSeekKey(event) {
  if (!(deck.value.duration > 0)) return
  const step = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0
  if (!step) return
  event.preventDefault()
  const base =
    scrubRatio.value !== null ? scrubRatio.value * deck.value.duration : deck.value.currentTime
  mixer.seekDeck(props.deckId, base + step)
}

/** First-run affordance: with nothing in the queue, send the user to the add field. */
function primaryDeckAction() {
  if (!queueEmpty.value) {
    mixer.cueNextTrack(props.deckId)
    return
  }

  const input = typeof document !== 'undefined' ? document.querySelector('.playlist__input') : null
  if (!input) return
  try {
    input.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  } catch {
    /* jsdom and old browsers */
  }
  try {
    input.focus({ preventScroll: true })
  } catch {
    input.focus()
  }
}

onMounted(() => {
  // YouTube replaces its target element with an iframe. Give it a node that Vue
  // does not track, so re-renders and unmounts never fight the player DOM.
  const host = document.createElement('div')
  host.className = 'deck__player-host'
  frame.value?.appendChild(host)
  mixer.attachDeckContainer(props.deckId, host)
})

onBeforeUnmount(() => {
  mixer.detachDeckContainer(props.deckId)
})
</script>

<template>
  <article
    class="deck"
    :class="[`deck--${deckId.toLowerCase()}`, { 'deck--active': isActive, 'deck--blocked': !deck.ready }]"
    :aria-label="`Deck ${deckId}`"
  >
    <header class="deck__head">
      <span class="deck__badge">Deck {{ deckId }}</span>
      <span class="deck__state" :class="`deck__state--${stateLabel}`">
        {{ deck.error ? 'error' : stateLabel }}
      </span>
    </header>

    <div class="deck__screen">
      <!-- YouTube replaces this div with its iframe. -->
      <div ref="frame" class="deck__player"></div>

      <div v-if="!deck.ready" class="deck__overlay">
        <span class="deck__overlay-mark">{{ deckId }}</span>
        <p>Starting player…</p>
      </div>

      <div v-else-if="!item" class="deck__overlay">
        <span class="deck__overlay-mark">{{ deckId }}</span>
        <p v-if="queueEmpty">No tracks yet — paste a YouTube link below to start.</p>
        <p v-else>Empty deck — cue the next queued track, or pick one with A / B.</p>
        <button
          type="button"
          class="btn btn--small btn--accent deck__cue"
          @click="primaryDeckAction"
        >
          <i class="fa-solid" :class="queueEmpty ? 'fa-plus' : 'fa-play'" aria-hidden="true"></i>
          {{ queueEmpty ? 'Add a track to start' : 'Cue next track' }}
        </button>
      </div>

      <div v-else-if="deck.error" class="deck__overlay">
        <p class="deck__error">{{ deck.error }}</p>
      </div>
    </div>

    <div class="deck__meta">
      <h2 class="deck__title" :title="item?.title ?? 'Empty deck'">
        {{ item?.title ?? 'No track loaded' }}
      </h2>
      <div class="deck__time">
        <span>{{ displayTime }}</span>
        <span>{{ formatClock(deck.duration) }}</span>
      </div>
    </div>

    <div
      class="deck__progress"
      :class="{ 'deck__progress--scrubbing': scrubRatio !== null }"
      role="slider"
      :tabindex="deck.duration > 0 ? 0 : -1"
      :aria-label="`Seek Deck ${deckId}`"
      aria-valuemin="0"
      :aria-valuemax="Math.round(deck.duration)"
      :aria-valuenow="Math.round(deck.currentTime)"
      :aria-valuetext="`${displayTime} of ${formatClock(deck.duration)}`"
      :aria-disabled="deck.duration > 0 ? 'false' : 'true'"
      @pointerdown="startScrub"
      @pointermove="moveScrub"
      @pointerup="endScrub"
      @pointercancel="endScrub"
      @keydown="onSeekKey"
    >
      <span :style="{ width: `${displayProgress}%` }"></span>
    </div>

    <div class="deck__controls">
      <button type="button" class="btn btn--accent" @click="mixer.playDeck(deckId)">
        <i class="fa-solid fa-play" aria-hidden="true"></i> Play
      </button>
      <button type="button" class="btn" @click="mixer.pauseDeck(deckId)">
        <i class="fa-solid fa-pause" aria-hidden="true"></i> Pause
      </button>
      <button type="button" class="btn" @click="mixer.stopDeck(deckId)">
        <i class="fa-solid fa-stop" aria-hidden="true"></i> Stop
      </button>
      <button
        v-if="item && (item.error || deck.error)"
        type="button"
        class="btn btn--warn"
        @click="mixer.ejectDeck(deckId)"
      >
        <i class="fa-solid fa-eject" aria-hidden="true"></i> Release
      </button>
    </div>

    <div class="deck__volume">
      <span class="deck__volume-label">Vol</span>
      <div class="meter" role="meter" :aria-valuenow="deck.volume" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${deck.volume}%` }"></span>
      </div>
      <b>{{ deck.volume }}</b>
      <span v-if="deck.buffering" class="deck__buffering">buffering</span>
    </div>
  </article>
</template>
