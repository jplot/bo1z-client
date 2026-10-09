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

const root = document.createElement('section');
root.className = 'kb-loading';
root.setAttribute('aria-live', 'polite');
root.innerHTML = `<div class="kb-art"></div><div class="kb-veil"></div>
  <a class="kb-back" href="/bo1z">Retour</a>
  <div class="kb-box">
    <div class="kb-kicker"></div><h2 class="kb-name"></h2><div class="kb-party"></div>
    <ol class="kb-steps"></ol><div class="kb-bar"><i></i></div>
    <p class="kb-prompt" hidden></p>
    <p class="kb-note" hidden><b>La souris n’a pas pu être capturée.</b> Clique encore une fois sur l’écran.</p>
    <div class="kb-error" hidden>
      <h3><span class="kb-warn">!</span><span class="kb-error-title"></span></h3><p class="kb-error-text"></p><p class="kb-error-hint"></p>
      <div class="kb-error-actions"><button class="kb-primary" type="button"></button><button class="kb-secondary kb-copy" type="button">Copier le rapport</button><a class="kb-secondary" href="/bo1z">Retour au menu</a></div>
      <details class="kb-details"><summary>Détails</summary><pre></pre></details>
    </div>
  </div>
  <aside class="kb-tip"><b>Astuce</b><span></span></aside>`;
const $ = selector => root.querySelector(selector);
$('.kb-art').style.backgroundImage = `url(art/loadscreen_${map.zone}.webp)`;
$('.kb-name').textContent = map.name;
$('.kb-party').hidden = !roomName;
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
  {
    label: 'Téléchargement de la carte',
    state: screen => (screen === 'download' ? 'now' : ['loading', 'ready', 'playing'].includes(screen) ? 'done' : 'wait'),
    detail: screen => (screen === 'download' ? progress().detail : ''),
  },
  {
    label: 'Chargement du moteur',
    state: screen => (screen === 'loading' ? 'now' : ['ready', 'playing'].includes(screen) ? 'done' : 'wait'),
    detail: screen => (screen === 'loading' ? progress().detail : ''),
  },
];
for (const step of steps) {
  step.item = document.createElement('li');
  step.item.append(Object.assign(document.createElement('span'), { textContent: step.label }), document.createElement('small'));
  $('.kb-steps').append(step.item);
}
const set = (element, key, value) => { if (element && element[key] !== value) element[key] = value; };

// La liaison WebRTC s'établit en une seconde environ : passé 30 s, elle n'arrivera plus, et l'invité jouerait seul sans le savoir.
const LINK_TIMEOUT = 30000;
const started = performance.now();
let hostName = 'l’hôte', failed = false;
const linkPending = () => Boolean(roomName) && role() !== 'host' && !kbnet()?.linked;
const reload = ['Recharger', () => location.reload()];
const retry = label => [label, () => document.getElementById('play')?.click()];

function roomProblem() {
  const net = kbnet();
  if (!roomName || !net) return null;
  if (net.signalFailed) return { title: 'Salon injoignable', text: 'Le serveur qui met les joueurs en relation ne répond pas.', hint: 'Vérifie ta connexion, puis réessaie.', primary: ['Réessayer', reload[1]] };
  if (role() !== 'guest') return null;
  if (net.hostLeft) {
    return { title: 'L’hôte a quitté la partie', text: `${hostName} a fermé le salon ${roomName} : la partie s’est arrêtée.`,
      hint: 'La manche en cours vivait chez lui et ne peut pas reprendre.' };
  }
  if (net.linked || !(net.linkFailed || performance.now() - started > LINK_TIMEOUT)) return null;
  return { title: `Impossible de rejoindre ${hostName}`, text: 'La liaison directe avec l’hôte n’a pas pu s’établir.',
    hint: 'Vos box bloquent sûrement la connexion directe. Sur le même réseau, ça passe ; par internet, il faudra un serveur relais (TURN).', primary: ['Réessayer', reload[1]] };
}

// Les erreurs de play.js (state.errorKind), dites avec nos mots ; son bouton #play porte déjà la bonne reprise.
function engineProblem() {
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
        hint: 'Rien n’est perdu : la reprise repart de là.', primary: retry('Reprendre') };
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
          hint: 'Ferme d’autres onglets et applications, puis recharge : la carte est déjà téléchargée.', primary: reload, report: true };
      }
      return { title: 'Le jeu a planté', text: 'Le moteur s’est arrêté sur une erreur.',
        hint: 'Recharge pour relancer la carte : elle est déjà téléchargée. Si ça recommence, copie le rapport pour signaler le problème.', primary: reload, report: true };
    default:
      return { title: 'Erreur', text: message, primary: reload };
  }
}

function fail({ title, text, hint = '', primary = null, report = false }) {
  failed = true;
  [sampling, tips].forEach(clearInterval);
  document.exitPointerLock?.();
  root.classList.remove('kb-ready', 'kb-gone');
  root.classList.add('kb-failed');
  $('.kb-error-title').textContent = title;
  $('.kb-error-text').textContent = text;
  $('.kb-error-hint').textContent = hint;
  $('.kb-primary').hidden = !primary;
  if (primary) [$('.kb-primary').textContent, $('.kb-primary').onclick] = primary;
  $('.kb-copy').hidden = $('.kb-details').hidden = !report;
  $('.kb-error').hidden = false;
}
$('.kb-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(globalThis.five?.crashReport ?? '');
    $('.kb-copy').textContent = 'Rapport copié';
  } catch {
    $('.kb-details').open = true;
    getSelection().selectAllChildren($('.kb-details pre'));
    $('.kb-copy').textContent = 'Cmd+C pour copier';
  }
});
$('.kb-details').addEventListener('toggle', () => { $('.kb-details pre').textContent = globalThis.five?.crashReport ?? ''; });

// Chez celui qui rejoint, le moteur passe « en jeu » sur sa partie locale, puis charge celle de l'hôte (écran en damier) :
// on n'est vraiment entré qu'une fois les instantanés de l'hôte arrivés sans interruption, au moins 2 par quart de seconde pendant 3 s.
let joined = false, joinStarted = 0;
const samples = [];
const sampling = setInterval(() => {
  samples.push(kbnet()?.received ?? 0);
  if (samples.length > 13) samples.shift();
  if (samples.length === 13 && samples.every((value, k) => k === 0 || value - samples[k - 1] >= 2)) joined = true;
}, 250);

// Tourne aussi une fois l'écran effacé : un plantage ou le départ de l'hôte en pleine partie le font revenir en erreur.
function render() {
  if (failed) return;
  const screen = document.body.dataset.screen;
  const problem = roomProblem() ?? (screen === 'error' && globalThis.five?.errorKind !== 'persistence' ? engineProblem() : null);
  if (problem) return fail(problem);
  const guest = role() === 'guest';
  if (screen === 'playing' && guest && !joinStarted) joinStarted = performance.now();
  const done = screen === 'error' || (screen === 'playing' && (!guest || joined || performance.now() - joinStarted > 120000));
  root.classList.toggle('kb-gone', done);
  if (done) return;
  // Le clic doit atteindre play.js lui-même : relayé depuis cet écran, Chrome refusait la capture de la souris.
  root.classList.toggle('kb-ready', screen === 'landing' || (screen === 'ready' && !linkPending()));
  set($('.kb-kicker'), 'textContent', roomName ? `Salon ${roomName}${role() === 'host' ? ' · tu es l’hôte' : ''}`
    : `Partie solo${query.get('horde') === '1' ? ' · Mode Enfer' : ''}`);
  for (const step of steps) {
    set(step.item, 'className', step.state(screen));
    set(step.item.lastChild, 'textContent', step.detail(screen));
  }
  const waiting = screen === 'playing' && guest && !joined;
  $('.kb-bar').classList.toggle('kb-wait', waiting);
  const width = waiting ? 30 : ['ready', 'playing'].includes(screen) ? 100 : ['download', 'loading'].includes(screen) ? progress().pct ?? 0 : 0;
  set($('.kb-bar i').style, 'width', `${width}%`);
  set($('.kb-prompt'), 'hidden', !(screen === 'ready' || waiting));
  set($('.kb-prompt'), 'textContent', waiting ? 'Entrée dans la partie de l’hôte…'
    : linkPending() ? `En attente de la liaison avec ${hostName}…` : 'Clique ou appuie sur une touche pour entrer');
  set($('.kb-dot'), 'className', `kb-dot ${kbnet()?.linked ? 'ok' : 'wait'}`);
  const notice = document.getElementById('notice');
  set($('.kb-note'), 'hidden', !(screen === 'ready' && notice && !notice.hidden && /declined/.test(notice.textContent)));
}
setInterval(render, 200);
render();

let shown = '';
async function party() {
  try {
    const room = (await (await fetch('/rooms', { cache: 'no-store' })).json()).find(entry => entry.name === roomName);
    const members = room?.members ?? [];
    const next = JSON.stringify([members, kbnet()?.label]);
    if (next !== shown) {
      shown = next;
      hostName = members.find(member => member.label === HOST)?.pseudo || 'l’hôte';
      $('.kb-party').replaceChildren(...members.map(({ label, pseudo }) => {
        const badge = Object.assign(document.createElement('span'), { className: label === kbnet()?.label ? 'me' : '', textContent: pseudo || 'Unknown Soldier' });
        if (label === HOST) badge.title = 'Hôte du salon';
        if (label === HOST && role() === 'guest') badge.prepend(Object.assign(document.createElement('i'), { className: 'kb-dot wait' }));
        return badge;
      }));
    }
  } catch {}
  if (!failed && !root.classList.contains('kb-gone')) setTimeout(party, 2000);
}
if (roomName) party();

document.addEventListener('keydown', event => {
  if (root.classList.contains('kb-gone')) return;
  const screen = document.body.dataset.screen;
  if (event.key === 'Escape' && (failed || screen !== 'playing')) return location.assign('/bo1z');
  // Écouteur posé avant celui de play.js : il retient la touche qui ferait entrer sans liaison, ou derrière une erreur.
  if (failed || (screen === 'ready' && linkPending())) { event.preventDefault(); event.stopImmediatePropagation(); }
});
