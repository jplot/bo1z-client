import { MAPS } from './catalog.mjs';

const NAME_KEY = 'bo1z-name';
const HELL_KEY = 'bo1z-horde';
const SETTINGS_KEY = 'bo1z-settings';
const HOST = '10.0.0.1';
const ERA = { 'World at War': 'waw', 'Black Ops': 'bo' };
// Que des consonnes : aucun mot ne peut se former, et pas de O ni de I à confondre avec 0 et 1.
const CODE = 'BCDFGHJKLMNPQRSTVWXZ';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const art = map => `art/loadscreen_${map.zone}.webp`;
const panel = map => `art/mapselect-panel-${map.slug}.webp`;
const bySlug = slug => MAPS.find(map => map.slug === slug);
const mapUrl = (map, params = {}) => `${map.slug}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
const isFull = room => room.players >= 4;
const el = (tag, className, html = '') => Object.assign(document.createElement(tag), { className, innerHTML: html });
const eraTitle = era => Object.assign(document.createElement('h3'), { className: `era-title ${ERA[era]}`, textContent: era });

const layers = [...document.querySelectorAll('.bg div')];
const codeBoxes = [...document.querySelectorAll('.code input')];
let front = 0, rooms = [], shown = '', typed = '', view = 'grid', picking = false, hovering = false, clearTimer = 0, selected = null;
let hell = read(HELL_KEY) === '1', invited = new URLSearchParams(location.search).get('room');

const off = map => hell && !map.horde && !picking;

function go(map, params) {
  location.assign(mapUrl(map, params));
}

function pick(map) {
  if (off(map)) return;
  if (picking) createRoom(map);
  else go(map, hell && map.horde ? { horde: '1' } : {});
}

async function lookup(code) {
  try {
    const response = await fetch(`/rooms?code=${code}`, { cache: 'no-store' });
    return response.ok ? (await response.json())[0] ?? null : null;
  } catch {
    return null;
  }
}

// Le premier arrivé d'un salon en est l'hôte : un code déjà pris ferait rejoindre la partie d'un autre, sur sa carte.
async function createRoom(map) {
  let name;
  do name = Array.from({ length: 4 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join('');
  while (await lookup(name));
  go(map, { room: name, ...($('private').getAttribute('aria-checked') === 'true' && { private: '1' }) });
}

function join(room) {
  const map = bySlug(room.map);
  if (map && !isFull(room)) go(map, { room: room.name, ...(room.private && { private: '1' }) });
}

function backdrop(map) {
  if (layers[front].dataset.zone === map.zone) return;
  front ^= 1;
  layers[front].style.backgroundImage = `url(${art(map)})`;
  layers[front].dataset.zone = map.zone;
  layers[front].classList.add('on');
  layers[front ^ 1].classList.remove('on');
}

function rotate() {
  if (hovering) return;
  const others = MAPS.filter(map => map.zone !== layers[front].dataset.zone);
  backdrop(others[Math.floor(Math.random() * others.length)]);
}

function hover(map) {
  clearTimeout(clearTimer);
  hovering = true;
  backdrop(map);
}

function unhover() {
  clearTimer = setTimeout(() => {
    hovering = false;
    selected = null;
    $('describe').replaceChildren();
    for (const row of document.querySelectorAll('.solo-list .row')) row.classList.remove('sel');
    document.querySelector('.solo-list .detail')?.classList.remove('on');
  }, 120);
}

function describe(map) {
  hover(map);
  $('describe').replaceChildren(Object.assign(document.createElement('b'), { textContent: map.name }), Object.assign(document.createElement('span'), { textContent: map.desc }));
}

function mapCard(map) {
  const card = el('button', `mapc ${ERA[map.era]}${off(map) ? ' off' : ''}`, '<div><b></b><span></span></div>');
  card.type = 'button';
  if (off(map)) card.setAttribute('aria-disabled', 'true');
  card.style.backgroundImage = `url(${panel(map)})`;
  card.querySelector('b').textContent = map.name;
  card.querySelector('span').textContent = map.horde && !picking ? 'Mode Enfer' : '';
  card.addEventListener('mouseenter', () => describe(map));
  card.addEventListener('focus', () => describe(map));
  card.addEventListener('mouseleave', unhover);
  card.addEventListener('blur', unhover);
  card.addEventListener('click', () => pick(map));
  return card;
}

function renderMaps() {
  $('describe').hidden = view === 'list';
  if (view === 'list') return renderList();
  $('maps').replaceChildren(...Object.keys(ERA).flatMap(era => {
    const grid = el('div', 'grid');
    grid.append(...MAPS.filter(map => map.era === era).map(mapCard));
    return [eraTitle(era), grid];
  }));
}

function renderList() {
  const list = el('div', 'maps');
  list.append(...Object.keys(ERA).flatMap(era => [eraTitle(era), ...MAPS.filter(map => map.era === era).map(map => {
    const row = el('button', `row ${ERA[era]}${off(map) ? ' off' : ''}`);
    row.type = 'button';
    row.textContent = map.name;
    row.dataset.slug = map.slug;
    if (off(map)) row.setAttribute('aria-disabled', 'true');
    row.addEventListener('mouseenter', () => select(map));
    row.addEventListener('focus', () => select(map));
    row.addEventListener('mouseleave', unhover);
    row.addEventListener('blur', unhover);
    row.addEventListener('click', () => pick(map));
    return row;
  })]));
  const wrap = el('div', 'solo-list');
  wrap.append(list, el('div', 'detail', '<div class="shot" role="img"></div><div class="kicker"></div><h2></h2><div class="place"></div><p class="desc"></p>'));
  $('maps').replaceChildren(wrap);
  if (selected) select(selected);
}

function select(map) {
  hover(map);
  selected = map;
  for (const row of document.querySelectorAll('.solo-list .row')) row.classList.toggle('sel', row.dataset.slug === map.slug);
  const detail = document.querySelector('.solo-list .detail');
  detail.querySelector('.shot').style.backgroundImage = `url(${panel(map)})`;
  detail.querySelector('.shot').setAttribute('aria-label', `Aperçu de ${map.name}`);
  Object.assign(detail.querySelector('.kicker'), { className: `kicker ${ERA[map.era]}`, textContent: `${map.era} · Carte ${String(MAPS.indexOf(map) + 1).padStart(2, '0')}` });
  detail.querySelector('h2').textContent = map.name;
  detail.querySelector('.place').textContent = map.place;
  detail.querySelector('.desc').textContent = map.desc;
  detail.classList.add('on');
}

function renderRooms() {
  $('count').textContent = rooms.length || '';
  if (!rooms.length) return $('rooms').replaceChildren(el('div', 'none', '<b>Aucun salon ouvert</b><span>Crée le premier, ou rejoins un ami avec son code.</span>'));
  const list = el('div', 'rlist', '<div class="head"><span></span><span>Salon</span><span>Carte</span><span>Joueurs</span><span>Places</span><span></span></div>');
  list.append(...rooms.map(room => {
    const map = bySlug(room.map);
    const line = el('div', `line${isFull(room) ? ' full' : ''}`, '<div class="thumb"></div><b></b><span class="cell"></span><div class="party"></div><span class="count"></span>');
    line.querySelector('b').textContent = room.name;
    line.querySelector('.cell').textContent = map?.name ?? room.map;
    const members = [...room.members].sort((a, b) => (b.label === HOST) - (a.label === HOST));
    line.querySelector('.party').append(...members.map(({ label, pseudo }) =>
      Object.assign(document.createElement('span'), { textContent: pseudo || 'Unknown Soldier', ...(label === HOST && { title: 'Hôte du salon' }) })));
    line.querySelector('.count').textContent = `${room.players} / 4`;
    const button = el('button', isFull(room) ? 'ghost' : 'ghost join', isFull(room) ? 'Complet' : 'Rejoindre');
    Object.assign(button, { type: 'button', disabled: isFull(room) });
    button.addEventListener('click', () => join(room));
    line.append(button);
    if (map) {
      line.querySelector('.thumb').style.backgroundImage = `url(${panel(map)})`;
      line.addEventListener('mouseenter', () => hover(map));
      line.addEventListener('mouseleave', unhover);
    }
    return line;
  }));
  $('rooms').replaceChildren(list);
}

function showTab(name) {
  $('tab-solo').setAttribute('aria-selected', String(name === 'solo'));
  $('tab-multi').setAttribute('aria-selected', String(name === 'multi'));
  $('tab-solo').hidden = $('tab-multi').hidden = picking;
  $('creating').hidden = $('cancel-pick').hidden = !picking;
  $('pane-solo').hidden = name !== 'solo';
  $('pane-multi').hidden = name !== 'multi';
  $('hell').hidden = name !== 'solo' || picking;
  $('views').hidden = name !== 'solo';
  $('create').hidden = $('open-code').hidden = name !== 'multi';
  $('private').hidden = !picking;
}

function startPicking() {
  picking = true;
  $('private').setAttribute('aria-checked', 'false');
  renderMaps();
  showTab('solo');
}

function stopPicking() {
  picking = false;
  renderMaps();
  showTab('multi');
}

// Un salon privé n'est pas dans la liste : le code se vérifie auprès du serveur, et seule la dernière saisie compte.
async function codeState() {
  const value = codeBoxes.map(box => box.value).join('');
  typed = value;
  $('join-code').disabled = true;
  if (value.length < 4) return void ($('code-note').textContent = '');
  const room = await lookup(value);
  if (typed !== value) return null;
  $('join-code').disabled = !room || isFull(room);
  $('code-note').textContent = !room ? 'Aucun salon avec ce code' : isFull(room) ? 'Ce salon est complet' : '';
  return room;
}

function fillCode(from, text) {
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '').slice(0, codeBoxes.length - from);
  [...letters].forEach((letter, k) => { codeBoxes[from + k].value = letter; });
  codeBoxes[Math.min(from + letters.length, codeBoxes.length - 1)].focus();
  codeState();
}

function openCode(text = '') {
  showTab('multi');
  for (const box of codeBoxes) box.value = '';
  $('joincode').showModal();
  fillCode(0, text);
}

async function joinCode() {
  const room = await codeState();
  if (!room || isFull(room)) return;
  $('joincode').close();
  join(room);
}

async function refresh() {
  try {
    const response = await fetch('/rooms', { cache: 'no-store' });
    if (response.ok) rooms = await response.json();
  } catch {}
  const key = JSON.stringify(rooms);
  if (key !== shown) {
    shown = key;
    renderRooms();
    if ($('joincode').open) codeState();
  }
  if (invited !== null) {
    openCode(invited);
    invited = null;
  }
  setTimeout(refresh, 2000);
}

function loadSettings() {
  try {
    return JSON.parse(read(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

// play.js relit cet objet au chargement de la carte ; il n'applique un volume enregistré que si volumeChosen est vrai.
function saveSettings(change) {
  write(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...change }));
}

function showSettings() {
  $('o-sens-v').textContent = Number($('o-sens').value).toFixed(1).replace('.', ',');
  $('o-vol-v').textContent = `${Math.round($('o-vol').value * 100)} %`;
}

function setPseudo(value) {
  $('pseudo').value = value.replace(/[^\w-]/g, '').slice(0, 15);
  write(NAME_KEY, $('pseudo').value);
}

codeBoxes.forEach((box, k) => {
  box.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key === 'Tab') return;
    event.preventDefault();
    if (/^[a-z]$/i.test(event.key)) fillCode(k, event.key);
    else if (event.key === 'Backspace' && !box.value && k > 0) { codeBoxes[k - 1].value = ''; codeBoxes[k - 1].focus(); codeState(); }
    else if (event.key === 'Backspace' || event.key === 'Delete') { box.value = ''; codeState(); }
    else if (event.key === 'ArrowLeft' && k > 0) codeBoxes[k - 1].focus();
    else if (event.key === 'ArrowRight' && k < codeBoxes.length - 1) codeBoxes[k + 1].focus();
    else if (event.key === 'Enter') joinCode();
    else if (event.key === 'Escape') $('joincode').close();
  });
  box.addEventListener('paste', event => { event.preventDefault(); fillCode(k, event.clipboardData.getData('text')); });
  box.addEventListener('input', () => fillCode(k, box.value));
});

const saved = loadSettings();
if (Number.isFinite(saved.sensitivity)) $('o-sens').value = saved.sensitivity;
if (saved.volumeChosen === true && Number.isFinite(saved.volume)) $('o-vol').value = saved.volume;
$('o-full').setAttribute('aria-checked', String(saved.fullscreen === true));
showSettings();
$('o-sens').addEventListener('input', () => { showSettings(); saveSettings({ sensitivity: Number($('o-sens').value) }); });
$('o-vol').addEventListener('input', () => { showSettings(); saveSettings({ volume: Number($('o-vol').value), volumeChosen: true }); });
$('o-full').addEventListener('click', () => {
  const on = $('o-full').getAttribute('aria-checked') !== 'true';
  $('o-full').setAttribute('aria-checked', String(on));
  saveSettings({ fullscreen: on });
});
$('open-options').addEventListener('click', () => { $('options').showModal(); $('options').focus(); });

$('pseudo').value = read(NAME_KEY) ?? '';
$('pseudo').addEventListener('input', () => setPseudo($('pseudo').value));
$('hell').setAttribute('aria-checked', String(hell));
$('hell').addEventListener('click', () => {
  hell = !hell;
  write(HELL_KEY, hell ? '1' : '0');
  $('hell').setAttribute('aria-checked', String(hell));
  renderMaps();
});
$('tab-solo').addEventListener('click', () => showTab('solo'));
$('tab-multi').addEventListener('click', () => showTab('multi'));
$('create').addEventListener('click', startPicking);
$('cancel-pick').addEventListener('click', stopPicking);
$('private').addEventListener('click', () => $('private').setAttribute('aria-checked', String($('private').getAttribute('aria-checked') !== 'true')));
$('open-code').addEventListener('click', () => openCode());
$('join-code').addEventListener('click', joinCode);
for (const button of document.querySelectorAll('.views button')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const other of document.querySelectorAll('.views button')) other.setAttribute('aria-pressed', String(other === button));
    renderMaps();
  });
}

document.addEventListener('keydown', event => { if (event.key === 'Escape' && picking) stopPicking(); });

renderMaps();
rotate();
setInterval(rotate, 6000);
refresh();
