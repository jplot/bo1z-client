<script setup lang="ts">
import { ref } from 'vue';
import { hordeCount, hordeDefaults, hordeRound } from '../../web/horde.js';
import { flag, read, write } from './store.ts';

const SETTINGS_KEY = 'bo1z-settings';
function load() {
  try {
    return JSON.parse(read(SETTINGS_KEY)!) ?? {};
  } catch {
    return {};
  }
}
// play.js relit cet objet au chargement de la carte ; il n'applique un volume enregistré que si volumeChosen est vrai.
const save = (change: object) => write(SETTINGS_KEY, JSON.stringify({ ...load(), ...change }));

const saved = load();
const dialog = ref<HTMLDialogElement>();
const sensitivity = ref(Number.isFinite(saved.sensitivity) ? saved.sensitivity : 5);
const volume = ref(saved.volumeChosen === true && Number.isFinite(saved.volume) ? saved.volume : 0.5);
const fullscreen = ref(saved.fullscreen === true);
const count = ref(hordeCount(saved.horde?.n ?? hordeDefaults.n));
const round = ref(hordeRound(saved.horde?.round ?? hordeDefaults.round));

function setSensitivity(value: string) { sensitivity.value = Number(value); save({ sensitivity: sensitivity.value }); }
function setVolume(value: string) { volume.value = Number(value); save({ volume: volume.value, volumeChosen: true }); }
function toggleFullscreen() { fullscreen.value = !fullscreen.value; save({ fullscreen: fullscreen.value }); }
function setHorde(input: HTMLInputElement, n: string, r: string) {
  count.value = hordeCount(n);
  round.value = hordeRound(r);
  input.value = String(input.id === 'o-n' ? count.value : round.value);
  save({ horde: { n: count.value, round: round.value } });
}

defineExpose({ open: () => { dialog.value!.showModal(); dialog.value!.focus(); } });
</script>

<template>
  <dialog ref="dialog" class="joincode options" id="options" tabindex="-1">
    <form method="dialog">
      <h2>Options</h2>
      <div class="opts">
        <div class="opt-group">Commandes</div>
        <label class="opt">Sensibilité de la souris<input type="range" id="o-sens" min="0.5" max="15" step="0.5" :value="sensitivity" @input="setSensitivity(($event.target as HTMLInputElement).value)"><output id="o-sens-v">{{ sensitivity.toFixed(1).replace('.', ',') }}</output></label>
        <div class="opt-group">Son</div>
        <label class="opt">Volume général<input type="range" id="o-vol" min="0" max="1" step="0.05" :value="volume" @input="setVolume(($event.target as HTMLInputElement).value)"><output id="o-vol-v">{{ Math.round(volume * 100) }} %</output></label>
        <div class="opt-group">Affichage</div>
        <div class="opt">Plein écran au lancement<button class="switch" id="o-full" type="button" role="switch" :aria-checked="flag(fullscreen)" @click="toggleFullscreen"><i></i></button></div>
        <div class="opt-group">Mode Enfer</div>
        <label class="opt">Zombies en même temps<input type="number" id="o-n" min="24" max="300" :value="count" @change="setHorde($event.target as HTMLInputElement, ($event.target as HTMLInputElement).value, String(round))"></label>
        <label class="opt">Manche de départ<input type="number" id="o-round" min="1" max="255" :value="round" @change="setHorde($event.target as HTMLInputElement, String(count), ($event.target as HTMLInputElement).value)"></label>
      </div>
      <div class="actions"><button class="ghost" type="submit">Retour</button></div>
    </form>
  </dialog>
</template>
