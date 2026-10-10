<script setup lang="ts">
import { computed, onUnmounted, ref, shallowReactive } from 'vue';
import { BASE, hiddenRoom, horde, map, room } from '../game/pack.ts';
import { enter, type Failure, retry, view } from '../game/session.ts';
import { HOST } from '../net/lan.ts';
import { link, linkPending, role } from '../net/link.ts';

type Problem = { title: string; text: string; hint?: string; primary?: [string, () => void]; report?: boolean };
type Member = { label: string; pseudo: string; me: boolean; dot: boolean };

const TIPS = [
  'Les zombies vont plus vite à chaque manche : garde une sortie.',
  'Barricade les fenêtres pour gagner des points entre deux vagues.',
  'Dans un salon, la partie de l’hôte continue même s’il ouvre le menu.',
  'Ton pseudo est celui que les autres voient au-dessus de ta tête.',
  'Échap ouvre le menu du jeu ; un clic sur l’image recapture la souris.',
];
const PARTS: Record<string, string> = { shaders: 'Shaders', sounds: 'Sons', textures: 'Textures', music: 'Musique et voix', map: 'Carte et modèles', engine: 'Moteur' };
const LINKS: Record<string, string> = { relay: 'connecté via le relais (un peu plus de latence)', ok: 'liaison directe', wait: 'liaison en cours' };
const kicker = room ? `Salon${hiddenRoom ? ' privé' : ''} ${room}` : `Partie solo${horde ? ' · Mode Enfer' : ''}`;
const reload: [string, () => void] = ['Recharger', () => location.reload()];

const ui = shallowReactive({ tip: '', party: [] as Member[], copy: 'Copier le rapport' });
const hostName = ref('l’hôte');
const details = ref<HTMLDetailsElement>();
const pre = ref<HTMLPreElement>();

let tip = Math.floor(Math.random() * TIPS.length);
const showTip = () => { ui.tip = TIPS[tip++ % TIPS.length]; };
showTip();
const tips = setInterval(showTip, 8000);

const megabytes = (bytes: number) => (bytes < 1e9 ? `${Math.ceil(bytes / 1e6)} Mo` : `${(bytes / 1e9).toFixed(1).replace('.', ',')} Go`);

function failureProblem(failure: Failure): Problem {
  switch (failure.kind) {
    case 'download':
      if (failure.files) {
        return { title: 'Fichiers du jeu illisibles', text: 'Le navigateur n’a pas pu lire ou écrire les fichiers enregistrés de la carte.',
          hint: 'Ferme les autres onglets de ce site, libère de l’espace disque, puis reprends.', primary: ['Reprendre', retry] };
      }
      return { title: 'Téléchargement interrompu', text: `La connexion s’est coupée${view.pct ? ` à ${view.pct} %` : ''} du téléchargement de ${map.name}.`,
        hint: 'Le téléchargement reprendra là où il s’est arrêté.', primary: ['Reprendre', retry] };
    case 'quota':
      return { title: 'Plus assez de place',
        text: failure.missingBytes ? `Il faut ${megabytes(failure.missingBytes)} libres pour installer ${map.name}.` : `Le navigateur n’a plus assez de place pour installer ${map.name}.`,
        hint: 'Libère de l’espace disque, ou efface les données de ce site dans les réglages du navigateur, puis réessaie.', primary: ['Réessayer', retry] };
    case 'storage':
      return { title: 'Stockage bloqué', text: 'Le navigateur interdit à ce site d’enregistrer les fichiers du jeu.',
        hint: 'Autorise le stockage pour ce site dans les réglages du navigateur, puis recharge.', primary: reload };
    case 'browser': case 'mobile': case 'gpu':
      return { title: 'Navigateur non pris en charge', text: 'Le jeu tourne sur Chrome ou Edge, sur ordinateur.',
        hint: 'Si c’est déjà le cas, vérifie que l’accélération matérielle est activée dans les réglages. Safari et les téléphones ne sont pas pris en charge.' };
    case 'secure':
      return { title: 'Connexion non sécurisée', text: 'Le jeu doit être ouvert en https, ou sur 127.0.0.1 en local.', hint: 'Ouvre l’adresse du site telle qu’elle t’a été donnée.' };
    case 'engine':
      if (failure.memory) {
        return { title: 'Pas assez de mémoire', text: `${map.name} n’a pas pu réserver assez de mémoire.`,
          hint: 'Ferme d’autres onglets et applications, puis recharge.', primary: reload, report: true };
      }
      return { title: 'Le jeu a planté', text: 'Le moteur s’est arrêté sur une erreur.',
        hint: 'Recharge pour relancer la carte. Si ça recommence, copie le rapport pour signaler le problème.', primary: reload, report: true };
  }
}

const problem = computed<Problem | null>(() => {
  if (link.failure === 'signal') return { title: 'Salon injoignable', text: 'Le serveur qui met les joueurs en relation ne répond pas.', hint: 'Vérifie ta connexion, puis réessaie.', primary: ['Réessayer', reload[1]] };
  if (link.failure === 'host-left') {
    return { title: 'L’hôte a quitté la partie', text: `${hostName.value} a fermé le salon ${room} : la partie s’est arrêtée.`, hint: 'La manche en cours vivait chez lui et ne peut pas reprendre.' };
  }
  if (link.failure === 'unreachable') {
    return { title: `Impossible de rejoindre ${hostName.value}`, text: 'La liaison directe avec l’hôte n’a pas pu s’établir.',
      hint: 'Vos box bloquent sûrement la connexion directe. Sur le même réseau, ça passe ; par internet, il faudra un serveur relais (TURN).', primary: ['Réessayer', reload[1]] };
  }
  return view.screen === 'error' && view.failure ? failureProblem(view.failure) : null;
});
const guest = computed(() => role() === 'guest');
const waiting = computed(() => view.screen === 'playing' && guest.value && !link.joined);
const gone = computed(() => !problem.value && view.screen === 'playing' && !waiting.value);
const full = computed(() => view.screen === 'ready' || view.screen === 'playing');
const parts = computed(() => !Object.keys(view.groups).length ? [] : Object.keys(PARTS).filter(key => key === 'engine' || view.groups[key]).map(key => {
  const [done, size] = view.groups[key] ?? [0, 1];
  return { key, pct: full.value ? 100 : Math.floor(100 * (key === 'engine' ? view.engine : done / size)), wait: key === 'engine' && waiting.value };
}));
const status = computed(() => (full.value ? 'Prêt' : view.screen === 'loading' ? 'Chargement du moteur' : 'Téléchargement de la carte'));
const eta = computed(() => {
  if (full.value || view.eta === null) return '';
  if (view.eta < 8) return 'presque fini';
  return view.eta < 60 ? `encore ${Math.max(5, Math.round(view.eta / 5) * 5)} s` : `encore ${Math.round(view.eta / 60)} min`;
});
const prompt = computed(() => (waiting.value ? 'Entrée dans la partie de l’hôte…'
  : linkPending() ? `En attente de la liaison avec ${hostName.value}…` : 'Clique ou appuie sur une touche pour entrer'));
const dot = computed(() => (link.relayed ? 'relay' : link.linked ? 'ok' : 'wait'));

async function copy() {
  try {
    await navigator.clipboard.writeText(view.report);
    ui.copy = 'Rapport copié';
  } catch {
    details.value!.open = true;
    getSelection()?.selectAllChildren(pre.value!);
    ui.copy = 'Cmd+C pour copier';
  }
}

function click(event: MouseEvent) {
  if (!(event.target as Element).closest('a, button, details')) enter();
}

let shown = '', polling = 0;
async function party() {
  try {
    const [found] = await (await fetch(`/rooms?code=${encodeURIComponent(room!)}`, { cache: 'no-store' })).json();
    const members: { label: string; pseudo: string }[] = found?.members ?? [];
    const next = JSON.stringify([members, link.label]);
    if (next !== shown) {
      shown = next;
      hostName.value = members.find(member => member.label === HOST)?.pseudo || 'l’hôte';
      ui.party = members.map(({ label, pseudo }) => ({ label, pseudo, me: label === link.label, dot: label === HOST && guest.value }));
    }
  } catch {}
  if (!problem.value && !gone.value) polling = setTimeout(party, 2000);
}
if (room) party();
onUnmounted(() => {
  clearInterval(tips);
  clearTimeout(polling);
});
</script>

<template>
  <section :class="['kb-loading', { 'kb-gone': gone, 'kb-failed': problem }]" aria-live="polite" @click="click">
    <div class="kb-art" :style="{ backgroundImage: `url(art/loadscreen_${map.zone}.webp)` }"></div><div class="kb-veil"></div>
    <a class="kb-back" :href="BASE">Annuler</a>
    <div class="kb-box">
      <div class="kb-kicker">{{ kicker }}</div><h2 class="kb-name">{{ map.name }}</h2>
      <div class="kb-party" :hidden="!room">
        <span v-for="member in ui.party" :key="member.label" :class="member.me ? 'me' : ''" :title="member.label === HOST ? 'Hôte du salon' : undefined"><i v-if="member.dot" :class="`kb-dot ${dot}`" :title="LINKS[dot]"></i>{{ member.pseudo || 'Unknown Soldier' }}</span>
      </div>
      <div class="kb-status"><i :class="full ? 'kb-ok' : ''"></i><span>{{ status }}</span><small>{{ eta }}</small></div>
      <div class="kb-timeline">
        <div v-for="part in parts" :key="part.key" :class="['kb-part', part.pct >= 100 ? 'done' : part.pct > 0 ? 'now' : 'wait', { 'kb-wait': part.wait }]">
          <div class="kb-track"><i :style="{ width: `${part.pct}%` }"></i></div><span>{{ PARTS[part.key] }}<em>{{ part.pct > 0 && part.pct < 100 ? `${part.pct} %` : '' }}</em></span>
        </div>
      </div>
      <p :class="['kb-prompt', { 'kb-off': !(view.screen === 'ready' || waiting) }]">{{ prompt }}</p>
      <p class="kb-note" :hidden="!(view.screen === 'ready' && view.declined)"><b>La souris n’a pas pu être capturée.</b> Clique encore une fois sur l’écran.</p>
      <div class="kb-error" :hidden="!problem">
        <h3><span class="kb-warn">!</span><span class="kb-error-title">{{ problem?.title }}</span></h3><p class="kb-error-text">{{ problem?.text }}</p><p class="kb-error-hint">{{ problem?.hint ?? '' }}</p>
        <div class="kb-error-actions"><button class="kb-primary" type="button" :hidden="!problem?.primary" @click="problem?.primary?.[1]()">{{ problem?.primary?.[0] }}</button><button class="kb-secondary kb-copy" type="button" :hidden="!problem?.report" @click="copy">{{ ui.copy }}</button><a class="kb-secondary" :href="BASE">Retour au menu</a></div>
        <details ref="details" class="kb-details" :hidden="!problem?.report"><summary>Détails</summary><pre ref="pre">{{ view.report }}</pre></details>
      </div>
    </div>
    <aside class="kb-tip"><b>Astuce</b><span>{{ ui.tip }}</span></aside>
  </section>
</template>
