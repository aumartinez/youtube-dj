<script setup>
import { computed } from 'vue'
import { thumbnailUrl } from '../lib/youtube'
import { useMixer } from '../stores/mixer'

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, required: true },
})

const mixer = useMixer()
const cover = computed(() => thumbnailUrl(props.item.videoId))
const paddedIndex = computed(() => String(props.index + 1).padStart(2, '0'))
</script>

<template>
  <li class="track" :class="[`track--${item.state}`, { 'track--broken': Boolean(item.error) }]">
    <button
      type="button"
      class="track__handle"
      aria-label="Drag to reorder"
      title="Drag to reorder"
    >
      <span aria-hidden="true">⋮⋮</span>
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

    <button
      type="button"
      class="track__remove"
      :aria-label="`Remove ${item.title}`"
      @click="mixer.removeTrack(item.id)"
    >
      ✕
    </button>
  </li>
</template>
