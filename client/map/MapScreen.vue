<script setup lang="ts">
import { defineAsyncComponent, onUnmounted, ref } from 'vue';
import { view } from '../game/session.ts';
import Loading from './Loading.vue';

const Perf = defineAsyncComponent(() => import('./Perf.vue'));
const perf = ref<'off' | 'compact' | 'detail'>('off');

// F3, caught on window before the game's keys and Chrome's find-next: compact, detailed, hidden.
function cycle(event: KeyboardEvent) {
  if (event.key !== 'F3' || event.repeat) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  perf.value = perf.value === 'off' ? 'compact' : perf.value === 'compact' ? 'detail' : 'off';
}
addEventListener('keydown', cycle, true);
onUnmounted(() => removeEventListener('keydown', cycle, true));
</script>

<template>
  <Loading />
  <p class="kb-resume" v-if="view.screen === 'playing' && view.resume">Clique pour reprendre</p>
  <Perf v-if="perf !== 'off'" :mode="perf" />
</template>
