<script setup>
import { computed } from 'vue'
import { thumbnailUrl } from '../lib/youtube'
import { useMixer } from '../stores/mixer'

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, required: true },
})

const mixer = useMixer()
const deckIds = ['A', 'B']

const cover = computed(() => thumbnailUrl(props.item.videoId))
const paddedIndex = computed(() => String(props.index + 1).padStart(2, '0'))

function isLoadDisabled(deckId) {
  if (props.item.deck === deckId) return true
  if (props.item.deck && mixer.state.decks[props.item.deck].playing) return true
  return false
}

function loadTitle(deckId) {
  if (props.item.deck === deckId) return `Already on Deck ${deckId}`
  if (props.item.deck && mixer.state.decks[props.item.deck].playing) {
    return `Deck ${props.item.deck} is playing this track — stop it first`
  }
  return `Load on Deck ${deckId}`
}
</script>

<template>
  <li class="track" :class="[`track--${item.state}`, { 'track--broken': Boolean(item.error) }]">
    <button
      type="button"
      class="track__handle"
      aria-label="Drag to reorder"
      title="Drag to reorder"
    >
      <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
    </button>

    <span class="track__index">{{ paddedIndex }}</span>

    <img class="track__cover" :src="cover" alt="" width="72" height="40" loading="lazy" />

    <div class="track__body">
      <p class="track__title" :title="item.title">{{ item.title }}</p>
      <p class="track__sub">
        <span class="badge" :class="`badge--${item.state}`">{{ item.state }}</span>
        <span v-if="item.deck" class="badge badge--deck">Deck {{ item.deck }}</span>
        <span v-if="item.error" class="track__err">{{ item.error }}</span>
      </p>
    </div>

    <div class="track__decks" role="group" aria-label="Load this track on a deck">
      <button
        v-for="deckId in deckIds"
        :key="deckId"
        type="button"
        class="track__load"
        :class="[
          `track__load--${deckId.toLowerCase()}`,
          { 'track__load--on': item.deck === deckId },
        ]"
        :disabled="isLoadDisabled(deckId)"
        :aria-label="`Load ${item.title} on Deck ${deckId}`"
        :title="loadTitle(deckId)"
        @click="mixer.loadTrackOnDeck(item.id, deckId)"
      >
        {{ deckId }}
      </button>
    </div>

    <button
      type="button"
      class="track__remove"
      :aria-label="`Remove ${item.title}`"
      title="Remove from playlist"
      @click="mixer.removeTrack(item.id)"
    >
      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
    </button>
  </li>
</template>
