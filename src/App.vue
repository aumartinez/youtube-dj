<script setup>
import { computed, onMounted } from 'vue'
import CrossfaderPanel from './components/CrossfaderPanel.vue'
import DeckPanel from './components/DeckPanel.vue'
import NoticeStack from './components/NoticeStack.vue'
import PlaylistPanel from './components/PlaylistPanel.vue'
import { useMixer } from './stores/mixer'

const mixer = useMixer()
const state = mixer.state
const counts = computed(() => mixer.trackCounts.value)

const apiLabel = computed(() => {
  switch (state.apiStatus) {
    case 'ready':
      return 'YouTube API ready'
    case 'loading':
      return 'Connecting to YouTube…'
    case 'error':
      return 'YouTube API offline'
    default:
      return 'Starting…'
  }
})

const apiTone = computed(
  () => ({ ready: 'ok', loading: 'warn', error: 'danger' })[state.apiStatus] ?? 'ghost',
)

onMounted(() => {
  mixer.init()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">DJ</span>
        <div class="brand__text">
          <h1>YouTube DJ Mixer</h1>
          <p>Two decks · one queue · smart crossfade</p>
        </div>
      </div>

      <div class="topbar__status">
        <span class="pill" :class="`pill--${apiTone}`">{{ apiLabel }}</span>
        <span class="pill pill--ghost">{{ counts.queued }} queued</span>
        <span class="pill pill--ghost">{{ counts.playing }} live</span>
        <span class="pill pill--ghost">{{ counts.played }} played</span>
      </div>
    </header>

    <div v-if="state.apiStatus === 'error'" class="banner banner--danger" role="alert">
      <div class="banner__text">
        <strong>YouTube IFrame API failed to load.</strong>
        <span>{{ state.apiError }} Check your connection or content blocker, then retry.</span>
      </div>
      <button type="button" class="btn btn--small" @click="mixer.retryApi()">Retry</button>
    </div>

    <div v-if="state.blockedDeck" class="banner banner--warn" role="alert">
      <div class="banner__text">
        <strong>Autoplay blocked by the browser.</strong>
        <span>Deck {{ state.blockedDeck }} needs a direct user gesture before it can play.</span>
      </div>
      <button type="button" class="btn btn--small btn--accent" @click="mixer.resumeFromGesture()">
        Start deck
      </button>
    </div>

    <main class="workspace">
      <section class="decks" aria-label="Decks">
        <DeckPanel deck-id="A" />
        <CrossfaderPanel />
        <DeckPanel deck-id="B" />
      </section>

      <PlaylistPanel />
    </main>

    <footer class="app-foot">
      <span>No backend, no API keys. Playlist state lives in your browser's localStorage.</span>
      <span>Audio only starts after a user gesture — browsers require it.</span>
    </footer>

    <NoticeStack />
  </div>
</template>
