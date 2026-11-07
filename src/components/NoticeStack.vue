<script setup>
import { useMixer } from '../stores/mixer'

const mixer = useMixer()
</script>

<template>
  <div class="notices" aria-live="polite" aria-atomic="false">
    <div
      v-for="notice in mixer.state.notices"
      :key="notice.id"
      class="notice"
      :class="`notice--${notice.tone}`"
    >
      <span>{{ notice.message }}</span>
      <button type="button" class="notice__close" aria-label="Dismiss" @click="mixer.dismissNotice(notice.id)">
        ✕
      </button>
    </div>
  </div>
</template>
