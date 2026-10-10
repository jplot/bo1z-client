<script setup lang="ts">
import { onUnmounted, ref, shallowReactive } from 'vue';
import { MAPS } from '../catalog.ts';

const props = defineProps<{ base: string }>();

type Problem = { title: string; text: string; hint?: string; primary?: [string, () => void]; report?: boolean };
type Member = { label: string; pseudo: string; me: boolean; dot: boolean };

const HOST = '10.0.0.1';
const TIPS = [
  'Les zombies vont plus vite à chaque manche : garde une sortie.',
  'Barricade les fenêtres pour gagner des points entre deux vagues.',
  'Dans un salon, la partie de l’hôte continue même s’il ouvre le menu.',
  'Ton pseudo est celui que les autres voient au-dessus de ta tête.',
  'Échap ouvre le menu du jeu ; un clic sur l’image recapture la souris.',
];
const PARTS: Record<string, string> = { shaders: 'Shaders', sounds: 'Sons', textures: 'Textures', music: 'Musique et voix', map: 'Carte et modèles', engine: 'Moteur' };
const LINKS: Record<string, string> = { relay: 'connecté via le relais (un peu plus de latence)', ok: 'liaison directe', wait: 'liaison en cours' };
const query = new URLSearchParams(location.search);
const roomName = query.get('room');
const map = MAPS.find(entry => entry.zone === document.documentElement.dataset.map) ?? MAPS.find(entry => entry.first)!;
const kbnet = () => globalThis.kbnet;
const role = () => (kbnet()?.label ? (kbnet()!.label === HOST ? 'host' : 'guest') : null);

const ui = shallowReactive({
  gone: false, ready: false, problem: null as Problem | null, kicker: '', status: '', full: false, detail: '',
  parts: [] as { key: string; pct: number; wait: boolean }[], promptOn: false, prompt: '', link: 'wait', note: false,
  tip: '', party: [] as Member[], copy: 'Copier le rapport', report: '',
});
const details = ref<HTMLDetailsElement>();
const pre = ref<HTMLPreElement>();

let tip = Math.floor(Math.random() * TIPS.length);
const showTip = () => { ui.tip = TIPS[tip++ % TIPS.length]; };
showTip();
const tips = setInterval(showTip, 8000);

// play.js n'a qu'une barre pour le téléchargement et le chargement ; son texte donne l'estimation du temps restant.
function progress() {
  const bar = document.getElementById('progress') as HTMLProgressElement | null;
  const pct = bar?.hasAttribute('value') ? Math.round(bar.value / (bar.max || 1) * 100) : null;
  const text = document.getElementById('transfer-details')?.textContent ?? '';
  const [, amount, unit] = /about (\d+) (s|min) left/.exec(text) ?? [];
  const eta = amount ? `encore ${amount} ${unit}` : /almost done/.test(text) ? 'presque fini' : '';
  return { pct, eta };
}

// Liaison directe ou relais du serveur : passé 30 s sans l'une ni l'autre, l'invité jouerait seul sans le savoir.
const LINK_TIMEOUT = 30000;
const started = performance.now();
let hostName = 'l’hôte';
const linkPending = () => Boolean(roomName) && role() !== 'host' && !kbnet()?.linked;
const reload: [string, () => void] = ['Recharger', () => location.reload()];
const retry = (label: string): [string, () => void] => [label, () => document.getElementById('play')?.click()];

function roomProblem(): Problem | null {
  const net = kbnet();
  if (!roomName || !net) return null;
  if (net.signalFailed) return { title: 'Salon injoignable', text: 'Le serveur qui met les joueurs en relation ne répond pas.', hint: 'Vérifie ta connexion, puis réessaie.', primary: ['Réessayer', reload[1]] };
  if (role() !== 'guest') return null;
  if (net.hostLeft) {
    return { title: 'L’hôte a quitté la partie', text: `${hostName} a fermé le salon ${roomName} : la partie s’est arrêtée.`,
      hint: 'La manche en cours vivait chez lui et ne peut pas reprendre.' };
  }
  if (net.linked || performance.now() - started <= LINK_TIMEOUT) return null;
  return { title: `Impossible de rejoindre ${hostName}`, text: 'La liaison directe avec l’hôte n’a pas pu s’établir.',
    hint: 'Vos box bloquent sûrement la connexion directe. Sur le même réseau, ça passe ; par internet, il faudra un serveur relais (TURN).', primary: ['Réessayer', reload[1]] };
}

// Les erreurs de play.js (state.errorKind), dites avec nos mots ; son bouton #play porte déjà la bonne reprise.
function engineProblem(): Problem {
  const kind = globalThis.five?.errorKind;
  const message = document.getElementById('error-message')?.textContent ?? '';
  const pct = progress().pct;
  const [, need, unit] = /needs up to ([\d.,]+) ([KMG])B/.exec(message) ?? [];
  switch (kind) {
    case 'download':
      if (/^OPFS /.test(message)) {
        return { title: 'Fichiers du jeu illisibles', text: 'Le navigateur n’a pas pu lire ou écrire les fichiers enregistrés de la carte.',
          hint: 'Ferme les autres onglets de ce site, libère de l’espace disque, puis reprends.', primary: retry('Reprendre') };
      }
      return { title: 'Téléchargement interrompu', text: `La connexion s’est coupée${pct ? ` à ${pct} %` : ''} du téléchargement de ${map.name}.`,
        hint: 'Le téléchargement reprendra là où il s’est arrêté.', primary: retry('Reprendre') };
    case 'quota':
      return { title: 'Plus assez de place', text: need ? `Il faut ${need} ${unit}o libres pour installer ${map.name}.` : `Le navigateur n’a plus assez de place pour installer ${map.name}.`,
        hint: 'Libère de l’espace disque, ou efface les données de ce site dans les réglages du navigateur, puis réessaie.', primary: retry('Réessayer') };
    case 'storage':
      return { title: 'Stockage bloqué', text: 'Le navigateur interdit à ce site d’enregistrer les fichiers du jeu.',
        hint: 'Autorise le stockage pour ce site dans les réglages du navigateur, puis recharge.', primary: reload };
    case 'browser': case 'mobile': case 'gpu':
      return { title: 'Navigateur non pris en charge', text: 'Le jeu tourne sur Chrome ou Edge, sur ordinateur.',
        hint: 'Si c’est déjà le cas, vérifie que l’accélération matérielle est activée dans les réglages. Safari et les téléphones ne sont pas pris en charge.' };
    case 'secure':
      return { title: 'Connexion non sécurisée', text: 'Le jeu doit être ouvert en https, ou sur 127.0.0.1 en local.', hint: 'Ouvre l’adresse du site telle qu’elle t’a été donnée.' };
    case 'engine':
      if (/memory|mémoire/i.test(message)) {
        return { title: 'Pas assez de mémoire', text: `${map.name} n’a pas pu réserver assez de mémoire.`,
          hint: 'Ferme d’autres onglets et applications, puis recharge.', primary: reload, report: true };
      }
      return { title: 'Le jeu a planté', text: 'Le moteur s’est arrêté sur une erreur.',
        hint: 'Recharge pour relancer la carte. Si ça recommence, copie le rapport pour signaler le problème.', primary: reload, report: true };
    default:
      return { title: 'Erreur', text: message, primary: reload };
  }
}

function fail(problem: Problem) {
  [sampling, tips].forEach(clearInterval);
  document.exitPointerLock?.();
  Object.assign(ui, { problem, ready: false, gone: false });
}

const loadReport = () => { ui.report = globalThis.five?.crashReport ?? ''; };

async function copy() {
  try {
    await navigator.clipboard.writeText(globalThis.five?.crashReport ?? '');
    ui.copy = 'Rapport copié';
  } catch {
    details.value!.open = true;
    getSelection()?.selectAllChildren(pre.value!);
    ui.copy = 'Cmd+C pour copier';
  }
}

// Chez celui qui rejoint, le moteur passe « en jeu » sur sa partie locale, puis charge celle de l'hôte (écran en damier) :
// on n'est vraiment entré qu'une fois les instantanés de l'hôte arrivés sans interruption, au moins 2 par quart de seconde pendant 3 s.
let joined = false, joinStarted = 0;
const samples: number[] = [];
const sampling = setInterval(() => {
  samples.push(kbnet()?.received ?? 0);
  if (samples.length > 13) samples.shift();
  if (samples.length === 13 && samples.every((value, k) => k === 0 || value - samples[k - 1] >= 2)) joined = true;
}, 250);

// Tourne aussi une fois l'écran effacé : un plantage ou le départ de l'hôte en pleine partie le font revenir en erreur.
function render() {
  if (ui.problem) return;
  const screen = document.body.dataset.screen;
  const problem = roomProblem() ?? (screen === 'error' && globalThis.five?.errorKind !== 'persistence' ? engineProblem() : null);
  if (problem) return fail(problem);
  const guest = role() === 'guest';
  if (screen === 'playing' && guest && !joinStarted) joinStarted = performance.now();
  ui.gone = screen === 'error' || (screen === 'playing' && (!guest || joined || performance.now() - joinStarted > 120000));
  if (ui.gone) return;
  // Le clic doit atteindre play.js lui-même : relayé depuis cet écran, Chrome refusait la capture de la souris.
  ui.ready = screen === 'landing' || (screen === 'ready' && !linkPending());
  ui.kicker = roomName ? `Salon${query.get('private') === '1' ? ' privé' : ''} ${roomName}` : `Partie solo${query.get('horde') === '1' ? ' · Mode Enfer' : ''}`;
  const waiting = screen === 'playing' && guest && !joined;
  const bar = globalThis.five?.loadbar, full = ['ready', 'playing'].includes(screen ?? '');
  if (bar?.groups) {
    ui.parts = Object.keys(PARTS).filter(key => key === 'engine' || bar.groups[key]).map(key => {
      const [done, size] = bar.groups[key] ?? [];
      return { key, pct: full ? 100 : Math.floor(100 * (key === 'engine' ? bar.engine ?? 0 : done / size)), wait: key === 'engine' && waiting };
    });
  }
  ui.status = full ? 'Prêt' : screen === 'loading' ? 'Chargement du moteur' : 'Téléchargement de la carte';
  ui.full = full;
  ui.detail = full ? '' : progress().eta;
  ui.promptOn = screen === 'ready' || waiting;
  ui.prompt = waiting ? 'Entrée dans la partie de l’hôte…' : linkPending() ? `En attente de la liaison avec ${hostName}…` : 'Clique ou appuie sur une touche pour entrer';
  ui.link = kbnet()?.relayed ? 'relay' : kbnet()?.linked ? 'ok' : 'wait';
  const notice = document.getElementById('notice');
  ui.note = screen === 'ready' && Boolean(notice) && !notice!.hidden && /declined/.test(notice!.textContent ?? '');
}
const rendering = setInterval(render, 200);
render();

let shown = '', polling = 0;
async function party() {
  try {
    const room = (await (await fetch('/rooms', { cache: 'no-store' })).json()).find((entry: { name: string }) => entry.name === roomName);
    const members: { label: string; pseudo: string }[] = room?.members ?? [];
    const next = JSON.stringify([members, kbnet()?.label]);
    if (next !== shown) {
      shown = next;
      hostName = members.find(member => member.label === HOST)?.pseudo || 'l’hôte';
      ui.party = members.map(({ label, pseudo }) => ({ label, pseudo, me: label === kbnet()?.label, dot: label === HOST && role() === 'guest' }));
    }
  } catch {}
  if (!ui.problem && !ui.gone) polling = setTimeout(party, 2000);
}
if (roomName) party();

function key(event: KeyboardEvent) {
  if (ui.gone) return;
  const screen = document.body.dataset.screen;
  if (event.key === 'Escape' && (ui.problem || screen !== 'playing')) return location.assign(props.base);
  // Écouteur posé avant celui de play.js : il retient la touche qui ferait entrer sans liaison, ou derrière une erreur.
  if (ui.problem || (screen === 'ready' && linkPending())) { event.preventDefault(); event.stopImmediatePropagation(); }
}
document.addEventListener('keydown', key);
onUnmounted(() => { [rendering, sampling, tips].forEach(clearInterval); clearTimeout(polling); document.removeEventListener('keydown', key); });
</script>

<template>
  <section :class="['kb-loading', { 'kb-gone': ui.gone, 'kb-ready': ui.ready, 'kb-failed': ui.problem }]" aria-live="polite">
    <div class="kb-art" :style="{ backgroundImage: `url(art/loadscreen_${map.zone}.webp)` }"></div><div class="kb-veil"></div>
    <a class="kb-back" :href="base">Annuler</a>
    <div class="kb-box">
      <div class="kb-kicker">{{ ui.kicker }}</div><h2 class="kb-name">{{ map.name }}</h2>
      <div class="kb-party" :hidden="!roomName">
        <span v-for="member in ui.party" :key="member.label" :class="member.me ? 'me' : ''" :title="member.label === HOST ? 'Hôte du salon' : undefined"><i v-if="member.dot" :class="`kb-dot ${ui.link}`" :title="LINKS[ui.link]"></i>{{ member.pseudo || 'Unknown Soldier' }}</span>
      </div>
      <div class="kb-status"><i :class="ui.full ? 'kb-ok' : ''"></i><span>{{ ui.status }}</span><small>{{ ui.detail }}</small></div>
      <div class="kb-timeline">
        <div v-for="part in ui.parts" :key="part.key" :class="['kb-part', part.pct >= 100 ? 'done' : part.pct > 0 ? 'now' : 'wait', { 'kb-wait': part.wait }]">
          <div class="kb-track"><i :style="{ width: `${part.pct}%` }"></i></div><span>{{ PARTS[part.key] }}<em>{{ part.pct > 0 && part.pct < 100 ? `${part.pct} %` : '' }}</em></span>
        </div>
      </div>
      <p :class="['kb-prompt', { 'kb-off': !ui.promptOn }]">{{ ui.prompt }}</p>
      <p class="kb-note" :hidden="!ui.note"><b>La souris n’a pas pu être capturée.</b> Clique encore une fois sur l’écran.</p>
      <div class="kb-error" :hidden="!ui.problem">
        <h3><span class="kb-warn">!</span><span class="kb-error-title">{{ ui.problem?.title }}</span></h3><p class="kb-error-text">{{ ui.problem?.text }}</p><p class="kb-error-hint">{{ ui.problem?.hint ?? '' }}</p>
        <div class="kb-error-actions"><button class="kb-primary" type="button" :hidden="!ui.problem?.primary" @click="ui.problem?.primary?.[1]()">{{ ui.problem?.primary?.[0] }}</button><button class="kb-secondary kb-copy" type="button" :hidden="!ui.problem?.report" @click="copy">{{ ui.copy }}</button><a class="kb-secondary" :href="base">Retour au menu</a></div>
        <details ref="details" class="kb-details" :hidden="!ui.problem?.report" @toggle="loadReport"><summary>Détails</summary><pre ref="pre">{{ ui.report }}</pre></details>
      </div>
    </div>
    <aside class="kb-tip"><b>Astuce</b><span>{{ ui.tip }}</span></aside>
  </section>
</template>
