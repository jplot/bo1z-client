import { MAPS } from './catalog.mjs';

// play.js lance alors le téléchargement sans attendre de touche, comme après un choix dans l'ancien menu de vel.gg :
// il ne reste qu'un clic, celui qui capture la souris.
globalThis.__kisakLandingPick = true;

const HOST = '10.0.0.1';
const TIPS = [
  'Les zombies vont plus vite à chaque manche : garde une sortie.',
  'Barricade les fenêtres pour gagner des points entre deux vagues.',
  'Dans un salon, la partie de l’hôte continue même s’il ouvre le menu.',
  'Ton pseudo est celui que les autres voient au-dessus de ta tête.',
  'Échap ouvre le menu du jeu ; un clic sur l’image recapture la souris.',
];
const query = new URLSearchParams(location.search);
const roomName = query.get('room');
const map = MAPS.find(entry => entry.zone === document.documentElement.dataset.map) ?? MAPS.find(entry => entry.first);
const kbnet = () => globalThis.kbnet;
const role = () => (kbnet()?.label ? (kbnet().label === HOST ? 'host' : 'guest') : null);
const read = (store, key) => { try { return store.getItem(key); } catch { return null; } };

const root = document.createElement('section');
root.className = 'kb-loading';
root.setAttribute('aria-live', 'polite');
root.innerHTML = `<div class="kb-art"></div><div class="kb-veil"></div>
  <a class="kb-back" href="/bo1z"><kbd>⎋</kbd>Retour</a>
  <div class="kb-box">
    <div class="kb-kicker"></div><h2 class="kb-name"></h2><div class="kb-party"></div>
    <ol class="kb-steps"></ol><div class="kb-bar"><i></i></div>
    <p class="kb-prompt" hidden>Clique ou appuie sur une touche pour entrer</p>
    <p class="kb-note" hidden><b>La souris n’a pas pu être capturée.</b> Clique encore une fois sur l’écran.</p>
  </div>
  <aside class="kb-tip"><b>Astuce</b><span></span></aside>`;
const $ = selector => root.querySelector(selector);
$('.kb-art').style.backgroundImage = `url(art/loadscreen_${map.zone}.webp)`;
$('.kb-name').textContent = map.name;
document.body.append(root);

let tip = Math.floor(Math.random() * TIPS.length);
const showTip = () => { $('.kb-tip span').textContent = TIPS[tip++ % TIPS.length]; };
showTip();
const tips = setInterval(showTip, 8000);

// play.js n'a qu'une barre pour le téléchargement et le chargement ; son texte donne l'estimation du temps restant.
function progress() {
  const bar = document.getElementById('progress');
  const pct = bar?.hasAttribute('value') ? Math.round(bar.value / (bar.max || 1) * 100) : null;
  const text = document.getElementById('transfer-details')?.textContent ?? '';
  const [, amount, unit] = /about (\d+) (s|min) left/.exec(text) ?? [];
  const eta = amount ? `encore ${amount} ${unit}` : /almost done/.test(text) ? 'presque fini' : '';
  return { pct, detail: pct === null ? '' : [`${pct} %`, eta].filter(Boolean).join(' · ') };
}

const steps = [
  ...(roomName ? [{
    label: () => (role() === 'guest' ? 'Liaison directe avec l’hôte' : 'Ouverture du salon'),
    state: () => (role() === 'host' || kbnet()?.linked ? 'done' : 'now'),
    detail: () => (role() === 'host' && read(sessionStorage, 'bo1z-copied') === roomName ? 'lien d’invitation copié' : ''),
  }] : []),
  {
    label: () => 'Téléchargement de la carte',
    state: screen => (screen === 'download' ? 'now' : ['loading', 'ready', 'playing'].includes(screen) ? 'done' : 'wait'),
    detail: screen => (screen === 'download' ? progress().detail : ''),
  },
  {
    label: () => 'Chargement du moteur',
    state: screen => (screen === 'loading' ? 'now' : ['ready', 'playing'].includes(screen) ? 'done' : 'wait'),
    detail: screen => (screen === 'loading' ? progress().detail : ''),
  },
  { label: () => 'Prêt', state: screen => (screen === 'ready' ? 'now' : screen === 'playing' ? 'done' : 'wait') },
  ...(roomName ? [{ guest: true, label: () => 'Entrée dans la partie de l’hôte', state: screen => (joined ? 'done' : screen === 'playing' ? 'now' : 'wait') }] : []),
];
for (const step of steps) {
  step.item = document.createElement('li');
  step.item.append(document.createElement('span'), document.createElement('small'));
  $('.kb-steps').append(step.item);
}
const set = (element, key, value) => { if (element[key] !== value) element[key] = value; };

// Chez celui qui rejoint, le moteur passe « en jeu » sur sa partie locale, puis charge celle de l'hôte (écran en damier) :
// on n'est vraiment entré qu'une fois les instantanés de l'hôte arrivés sans interruption, au moins 2 par quart de seconde pendant 3 s.
let joined = false, joinStarted = 0;
const samples = [];
const sampling = setInterval(() => {
  samples.push(kbnet()?.received ?? 0);
  if (samples.length > 13) samples.shift();
  if (samples.length === 13 && samples.every((value, k) => k === 0 || value - samples[k - 1] >= 2)) joined = true;
}, 250);

function render() {
  const screen = document.body.dataset.screen;
  const guest = role() === 'guest';
  if (screen === 'playing' && guest && !joinStarted) joinStarted = performance.now();
  const done = screen === 'error' || (screen === 'playing' && (!guest || joined || performance.now() - joinStarted > 120000));
  root.classList.toggle('kb-gone', done);
  // Le clic doit atteindre play.js lui-même : relayé depuis cet écran, Chrome refusait la capture de la souris.
  root.classList.toggle('kb-ready', ['landing', 'ready'].includes(screen));
  set($('.kb-kicker'), 'textContent', roomName ? `Salon ${roomName}${role() === 'host' ? ' · tu es l’hôte' : ''}`
    : `Partie solo${query.get('horde') === '1' ? ' · Mode Enfer' : ''}`);
  for (const step of steps) {
    set(step.item, 'hidden', Boolean(step.guest && !guest));
    set(step.item, 'className', step.state(screen));
    set(step.item.firstChild, 'textContent', step.label(screen));
    set(step.item.lastChild, 'textContent', step.detail?.(screen) ?? '');
  }
  const waiting = screen === 'playing' && guest && !joined;
  $('.kb-bar').classList.toggle('kb-wait', waiting);
  const width = waiting ? 30 : ['ready', 'playing'].includes(screen) ? 100 : ['download', 'loading'].includes(screen) ? progress().pct ?? 0 : 0;
  set($('.kb-bar i').style, 'width', `${width}%`);
  set($('.kb-prompt'), 'hidden', screen !== 'ready');
  const notice = document.getElementById('notice');
  set($('.kb-note'), 'hidden', !(screen === 'ready' && notice && !notice.hidden && /declined/.test(notice.textContent)));
  if (done) [ticking, sampling, tips].forEach(clearInterval);
}
const ticking = setInterval(render, 200);
render();

let names = '';
async function party() {
  try {
    const room = (await (await fetch('/rooms', { cache: 'no-store' })).json()).find(entry => entry.name === roomName);
    const next = JSON.stringify(room?.names ?? []);
    if (next !== names) {
      names = next;
      $('.kb-party').replaceChildren(...JSON.parse(next).map((name, k) =>
        Object.assign(document.createElement('span'), { className: k === 0 ? 'host' : '', textContent: name || 'Unknown Soldier' })));
    }
  } catch {}
  if (!root.classList.contains('kb-gone')) setTimeout(party, 2000);
}
if (roomName) party();

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.dataset.screen !== 'playing' && !root.classList.contains('kb-gone')) location.assign('/bo1z');
});
