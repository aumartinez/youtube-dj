<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatClock } from '../lib/youtube'
import { useMixer } from '../stores/mixer'

const props = defineProps({
  deckId: { type: String, required: true },
})

const mixer = useMixer()
const frame = ref(null)

const deck = computed(() => mixer.state.decks[props.deckId])
const item = computed(() => mixer.deckItem(props.deckId))
const isActive = computed(() => mixer.state.activeDeck === props.deckId && deck.value.playing)
const progress = computed(() => {
  if (!deck.value.duration) return 0
  return Math.min(100, Math.max(0, (deck.value.currentTime / deck.value.duration) * 100))
})
const stateLabel = computed(() => item.value?.state ?? 'empty')

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

      <div v-if="!deck.ready || !item || deck.error" class="deck__overlay">
        <p v-if="deck.error" class="deck__error">{{ deck.error }}</p>
        <template v-else-if="!deck.ready">
          <span class="deck__overlay-mark">{{ deckId }}</span>
          <p>Starting player…</p>
        </template>
        <template v-else>
          <span class="deck__overlay-mark">{{ deckId }}</span>
          <p>Empty deck — hit Play to take the next queued track.</p>
        </template>
      </div>
    </div>

    <div class="deck__meta">
      <h2 class="deck__title" :title="item?.title ?? 'Empty deck'">
        {{ item?.title ?? 'No track loaded' }}
      </h2>
      <div class="deck__time">
        <span>{{ formatClock(deck.currentTime) }}</span>
        <span>{{ formatClock(deck.duration) }}</span>
      </div>
    </div>

    <div class="deck__progress" role="presentation">
      <span :style="{ width: `${progress}%` }"></span>
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
