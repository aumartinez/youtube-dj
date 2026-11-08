<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Sortable from 'sortablejs'
import PlaylistTrack from './PlaylistTrack.vue'
import { useMixer } from '../stores/mixer'

const mixer = useMixer()
const listElement = ref(null)
const url = ref('')
const formError = ref('')
let sortable = null

const counts = computed(() => mixer.trackCounts.value)
const hasPlayed = computed(() => counts.value.played > 0)

function submit() {
  const result = mixer.addTrack(url.value)
  if (!result.ok) {
    formError.value = result.error
    return
  }
  formError.value = ''
  url.value = ''
}

function onDragEnd(event) {
  const { oldIndex, newIndex } = event
  if (oldIndex === null || newIndex === null || oldIndex === newIndex) return

  // Sortable already moved the node; put it back, then let Vue own the DOM.
  const parent = event.from
  event.item.remove()
  parent.insertBefore(event.item, parent.children[oldIndex] ?? null)
  mixer.moveTrack(oldIndex, newIndex)
}

onMounted(() => {
  if (!listElement.value) return
  try {
    sortable = Sortable.create(listElement.value, {
      animation: 160,
      handle: '.track__handle',
      ghostClass: 'track--ghost',
      chosenClass: 'track--chosen',
      dragClass: 'track--dragging',
      onEnd: onDragEnd,
    })
  } catch (error) {
    // Drag and drop is an enhancement; the list still works without it.
    console.warn('[playlist] SortableJS could not start:', error)
  }
})

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<template>
  <section class="playlist" aria-label="Shared playlist">
    <header class="playlist__head">
      <div>
        <h2>Playlist</h2>
        <p class="playlist__sub">
          {{ counts.queued }} queued · {{ counts.loaded }} loaded · {{ counts.playing }} playing ·
          {{ counts.played }} played
        </p>
      </div>
      <button v-if="hasPlayed" type="button" class="btn btn--small btn--ghost" @click="mixer.clearPlayed()">
        <i class="fa-solid fa-broom" aria-hidden="true"></i>
        Clear played
      </button>
    </header>

    <form class="playlist__form" @submit.prevent="submit">
      <input
        v-model="url"
        class="playlist__input"
        type="text"
        inputmode="url"
        placeholder="https://www.youtube.com/watch?v=…"
        aria-label="YouTube URL"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" class="btn btn--accent">
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
        Add track
      </button>
    </form>
    <p v-if="formError" class="playlist__error" role="alert">{{ formError }}</p>

    <p v-if="!mixer.state.items.length" class="playlist__empty">
      The queue is empty. Paste a YouTube link above, then press Play on a deck — Deck A takes the
      first track, Deck B the next one.
    </p>

    <ul v-else ref="listElement" class="tracks">
      <PlaylistTrack
        v-for="(item, index) in mixer.state.items"
        :key="item.id"
        :item="item"
        :index="index"
      />
    </ul>

    <p class="playlist__hint">
      Drag the handle to reorder. Use the <b>A</b> / <b>B</b> buttons to load or replace that
      deck's track — a playing track keeps playing, a cued one stays cued.
    </p>
  </section>
</template>
