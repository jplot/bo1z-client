import { MAPS } from './catalog.mjs';

const NAME_KEY = 'bo1z-name';
const HELL_KEY = 'bo1z-horde';
const MAP_KEY = 'bo1z-map';

const $ = id => document.getElementById(id);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const art = map => `art/loadscreen_${map.zone}.webp`;
const panel = map => `art/mapselect-panel-${map.slug}.webp`;
const mapUrl = (map, params = {}) => `${map.slug}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
const inviteUrl = name => `${location.origin}/bo1z?room=${encodeURIComponent(name)}`;
const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

const layers = [...document.querySelectorAll('.bg div')];
let current = -1, front = 0, rooms = [], hell = read(HELL_KEY) === '1', invited = new URLSearchParams(location.search).get('room');

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('on'), 2600);
}

function go(map, params) {
  write(MAP_KEY, map.slug);
  location.assign(mapUrl(map, params));
}

function renderMaps() {
  let era;
  $('maps').replaceChildren(...MAPS.flatMap((map, i) => {
    const nodes = [];
    if (map.era !== era) {
      era = map.era;
      nodes.push(Object.assign(document.createElement('div'), { className: 'era', textContent: era }));
    }
    const button = Object.assign(document.createElement('button'), { className: 'map', type: 'button' });
    button.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span class="name"></span><span class="live" hidden></span>`;
    button.querySelector('.name').textContent = map.name;
    button.addEventListener('mouseenter', () => select(i));
    button.addEventListener('focus', () => select(i));
    button.addEventListener('click', play);
    nodes.push(button);
    return nodes;
  }));
}

function select(i) {
  if (i === current) return;
  current = i;
  const map = MAPS[i];
  document.querySelectorAll('.map').forEach((button, k) => button.classList.toggle('selected', k === i));
  front ^= 1;
  layers[front].style.backgroundImage = `url(${art(map)})`;
  layers[front].classList.add('on');
  layers[front ^ 1].classList.remove('on');
  $('shot').style.backgroundImage = `url(${panel(map)})`;
  $('shot').setAttribute('aria-label', `Aperçu de ${map.name}`);
  $('kicker').textContent = `${map.era} · Carte ${String(i + 1).padStart(2, '0')}`;
  $('name').textContent = map.name;
  $('place').textContent = map.place;
  $('desc').textContent = map.desc;
  $('hell').hidden = !map.horde;
  $('create-label').textContent = `Créer un salon sur ${map.name}`;
  renderRooms();
}

function renderRooms() {
  const map = MAPS[current];
  const here = rooms.filter(room => room.map === map.slug);
  const tags = [[`${map.size.toFixed(1).replace('.', ',')} Go à télécharger une fois`], ...(map.horde ? [['Mode Enfer disponible', true]] : []),
    ...(here.length ? [[`${plural(here.length, 'salon')} ouvert${here.length > 1 ? 's' : ''}`, true]] : [])];
  $('tags').replaceChildren(...tags.map(([text, hot]) => Object.assign(document.createElement('span'), { className: `tag${hot ? ' hot' : ''}`, textContent: text })));
  document.querySelectorAll('.map').forEach((button, k) => {
    const live = rooms.filter(room => room.map === MAPS[k].slug).length;
    Object.assign(button.querySelector('.live'), { hidden: !live, textContent: live });
  });
  $('count').textContent = `${rooms.length} ouvert${rooms.length > 1 ? 's' : ''}`;
  $('hell-note').hidden = !(hell && map.horde);
  const sorted = [...rooms].sort((a, b) => (b.map === map.slug) - (a.map === map.slug));
  $('rooms').replaceChildren(...(sorted.length ? sorted.map(room => {
    const roomMap = MAPS.find(entry => entry.slug === room.map);
    const row = document.createElement('div');
    row.className = `room${room.map === map.slug ? ' here' : ''}`;
    row.innerHTML = '<div class="thumb"></div><div><b></b><span></span></div><button class="join" type="button">Rejoindre</button>';
    if (roomMap) row.querySelector('.thumb').style.backgroundImage = `url(${panel(roomMap)})`;
    row.querySelector('b').textContent = room.name;
    row.querySelector('span').textContent = roomMap?.name ?? room.map;
    row.querySelector('span').insertAdjacentHTML('beforeend',
      `<span class="dots">${[0, 1, 2, 3].map(k => `<i class="${k < room.players ? 'in' : ''}"></i>`).join('')}</span>`);
    row.querySelector('.join').addEventListener('click', () => join(room));
    return row;
  }) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Aucun salon ouvert. Crée le premier !' })]));
}

function play() {
  const map = MAPS[current];
  go(map, hell && map.horde ? { horde: '1' } : {});
}

function join(room) {
  const map = MAPS.find(entry => entry.slug === room.map);
  if (map) go(map, { room: room.name });
}

// Le premier arrivé d'un salon en est l'hôte : un nom déjà pris ferait rejoindre la partie d'un autre, sur sa carte.
async function create(name) {
  if (!name) return toast('Donne un nom au salon.');
  if (rooms.some(room => room.name === name)) return toast(`Le salon « ${name} » existe déjà.`);
  await navigator.clipboard?.writeText(inviteUrl(name)).catch(() => {});
  go(MAPS[current], { room: name });
}

function invite(name) {
  const room = rooms.find(entry => entry.name === name);
  const map = room && MAPS.find(entry => entry.slug === room.map);
  $('invite-title').textContent = room ? 'Invitation' : 'Salon introuvable';
  $('invite-text').textContent = room ? `Salon « ${room.name} » sur ${map?.name ?? room.map} · ${plural(room.players, 'joueur')}.`
    : `Le salon « ${name} » est fermé, ou son hôte n’a pas encore lancé la carte.`;
  $('invite-link').hidden = true;
  $('invite-pseudo-field').hidden = !room;
  $('invite-pseudo').value = $('pseudo').value;
  $('invite-go').hidden = !room;
  $('invite').onclose = () => {
    if ($('invite').returnValue !== 'go' || !room) return;
    setPseudo($('invite-pseudo').value);
    join(room);
  };
  $('invite').showModal();
}

function pasteInvite() {
  $('invite-title').textContent = 'Rejoindre un salon';
  $('invite-text').textContent = 'Colle le lien d’invitation que l’hôte t’a envoyé, ou juste le nom du salon.';
  Object.assign($('invite-link'), { hidden: false, value: '' });
  $('invite-pseudo-field').hidden = true;
  $('invite-go').hidden = false;
  $('invite').onclose = () => {
    const value = $('invite-link').value.trim();
    if ($('invite').returnValue !== 'go' || !value) return;
    let name = value;
    try { name = new URL(value).searchParams.get('room') ?? value; } catch {}
    invite(name);
  };
  $('invite').showModal();
}

async function refresh() {
  try {
    const response = await fetch('/rooms', { cache: 'no-store' });
    if (response.ok) rooms = await response.json();
  } catch {}
  renderRooms();
  if (invited) {
    invite(invited);
    invited = null;
  }
  setTimeout(refresh, 2000);
}

function setPseudo(value) {
  $('pseudo').value = value.replace(/[^\w-]/g, '').slice(0, 15);
  write(NAME_KEY, $('pseudo').value);
}

$('pseudo').value = read(NAME_KEY) ?? '';
$('pseudo').addEventListener('input', () => setPseudo($('pseudo').value));
$('invite-pseudo').addEventListener('input', event => { event.target.value = event.target.value.replace(/[^\w-]/g, '').slice(0, 15); });
$('hell').setAttribute('aria-checked', String(hell));
$('hell').addEventListener('click', () => {
  hell = !hell;
  write(HELL_KEY, hell ? '1' : '0');
  $('hell').setAttribute('aria-checked', String(hell));
  renderRooms();
});
$('play').addEventListener('click', play);
$('paste').addEventListener('click', pasteInvite);
$('room').value = `salon-${crypto.randomUUID().slice(0, 4)}`;
$('create').addEventListener('submit', event => {
  event.preventDefault();
  create($('room').value.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''));
});

document.addEventListener('keydown', event => {
  if (event.target.matches('input') || $('invite').open) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = (current + (event.key === 'ArrowDown' ? 1 : MAPS.length - 1)) % MAPS.length;
    document.querySelectorAll('.map')[next].focus();
  } else if (event.key === 'Enter' && !event.target.matches('button')) play();
  else if (event.key.toLowerCase() === 'e' && MAPS[current].horde) $('hell').click();
  else if (event.key.toLowerCase() === 's') document.querySelector('.join, #room')?.focus();
});

renderMaps();
select(Math.max(0, MAPS.findIndex(map => map.slug === read(MAP_KEY))));
refresh();
