<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Sortable from 'sortablejs'
import PlaylistTrack from './PlaylistTrack.vue'
import { useMixer } from '../stores/mixer'

const mixer = useMixer()
const listElement = ref(null)
const url = ref('')
const formError = ref('')
const formWarning = ref('')
let sortable = null

const counts = computed(() => mixer.trackCounts.value)
const hasPlayed = computed(() => counts.value.played > 0)
const isImporting = computed(() => mixer.state.importing.active)
const repeatList = computed(() => mixer.state.settings.repeatList)

async function submit() {
  formError.value = ''
  formWarning.value = ''
  const result = await mixer.submitUrl(url.value)
  if (!result.ok) {
    formError.value = result.error
    return
  }
  url.value = ''
  if (result.warning) formWarning.value = result.warning
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
      <div class="playlist__controls">
        <button
          type="button"
          class="switch switch--labeled"
          :class="{ 'switch--on': repeatList }"
          role="switch"
          :aria-checked="repeatList"
          title="When the queue runs out, requeue every played track and start again"
          @click="mixer.setRepeatList(!repeatList)"
        >
          <span class="switch__dot" aria-hidden="true"></span>
          Repeat list
        </button>
        <button
          v-if="hasPlayed"
          type="button"
          class="btn btn--small btn--ghost"
          @click="mixer.requeuePlayed()"
        >
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          Requeue played
        </button>
        <button
          v-if="hasPlayed"
          type="button"
          class="btn btn--small btn--ghost"
          @click="mixer.clearPlayed()"
        >
          <i class="fa-solid fa-broom" aria-hidden="true"></i>
          Clear played
        </button>
      </div>
    </header>

    <form class="playlist__form" @submit.prevent="submit">
      <input
        v-model="url"
        class="playlist__input"
        type="text"
        inputmode="url"
        placeholder="Video or playlist URL — watch?v=… / playlist?list=…"
        aria-label="YouTube video or playlist URL"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" class="btn btn--accent" :disabled="isImporting">
        <i class="fa-solid" :class="isImporting ? 'fa-spinner fa-spin' : 'fa-plus'" aria-hidden="true"></i>
        {{ isImporting ? 'Importing…' : 'Add' }}
      </button>
    </form>
    <p v-if="formError" class="playlist__error" role="alert">{{ formError }}</p>
    <p v-if="formWarning" class="playlist__warning" role="status">{{ formWarning }}</p>

    <p v-if="isImporting" class="playlist__import" role="status">
      <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
      {{ mixer.state.importing.phase }}
    </p>

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
      Load: press <b>Cue next track</b> on an empty deck, or use the <b>A</b> / <b>B</b> buttons
      to send a row to that deck. Paste a video URL for one track or a public playlist URL to
      import all of them. Drag the handle to reorder. <b>Repeat list</b> starts over when the
      queue runs out; <b>Requeue played</b> puts finished tracks back without waiting.
    </p>
  </section>
</template>
