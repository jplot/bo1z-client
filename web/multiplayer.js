// landing.js transmet sa propre query à la carte choisie : /bo1z?room=x ouvre la carte cliquée dans le salon x.
const MAPS = {
  kino: 'Kino der Toten', five: '"Five"', riese: 'Der Riese', nacht: 'Nacht der Untoten', verruckt: 'Verrückt',
  shinonuma: 'Shi No Numa', ascension: 'Ascension', cotd: 'Call of the Dead', shangrila: 'Shangri-La', moon: 'Moon',
};
const room = new URLSearchParams(location.search).get('room');
const stage = document.querySelector('.stage');
const pct = (value, total) => `${(value / total * 100).toFixed(3)}%`;

const style = Object.assign(document.createElement('style'), { textContent: `
  .stage { container-type: size; }
  .mp-row, .mp-panel button, .mp-panel h3 { font: 600 2.3cqh/1 "Helvetica Neue", "Arial Narrow", Arial, sans-serif; font-stretch: condensed; text-transform: uppercase; letter-spacing: .02em; }
  .mp-row { position: absolute; left: ${pct(352, 1920)}; top: ${pct(841, 1080)}; width: ${pct(450, 1920)}; height: ${pct(40, 1080)};
    z-index: 3; border: 0; padding: 0 0 0 2.4cqw; text-align: left; color: #e9e3d6; background: rgba(28, 6, 4, .45); cursor: pointer; }
  .mp-row:hover, .mp-row:focus-visible { background: #f1efe9; color: #111; outline: none; }
  .mp-panel { position: absolute; left: ${pct(850, 1920)}; top: ${pct(240, 1080)}; width: ${pct(750, 1920)}; height: ${pct(720, 1080)};
    z-index: 4; box-sizing: border-box; padding: 2.4cqh 1.6cqw; overflow: auto; color: #e9e3d6; background: rgba(36, 8, 6, .94);
    border: 1px solid rgba(255, 255, 255, .15); font: 1.9cqh/1.4 "Helvetica Neue", Arial, sans-serif; }
  .mp-panel[hidden] { display: none; }
  .mp-panel h3 { margin: 2cqh 0 1cqh; color: #f1efe9; font-size: 2.2cqh; }
  .mp-panel h3:first-child { margin-top: 0; font-size: 3cqh; }
  .mp-panel input { box-sizing: border-box; width: 100%; padding: .8cqh .6cqw; font: inherit; color: #111; background: #f1efe9; border: 0; }
  .mp-panel button { display: block; width: 100%; margin-top: .8cqh; padding: .9cqh .8cqw; border: 0; text-align: left; font-size: 2cqh;
    color: #e9e3d6; background: rgba(0, 0, 0, .35); cursor: pointer; }
  .mp-panel button:hover, .mp-panel button:focus-visible { background: #f1efe9; color: #111; outline: none; }
  .mp-panel .mp-note { margin: .6cqh 0 0; color: #b9ad9c; font-size: 1.7cqh; }
` });
style.dataset.landing = '';
document.head.append(style);

const row = Object.assign(document.createElement('button'), { type: 'button', className: 'mp-row' });
const panel = Object.assign(document.createElement('section'), { className: 'mp-panel', hidden: true });
panel.setAttribute('aria-label', 'Multijoueur');
stage.append(row, panel);

const button = (text, onclick) => Object.assign(document.createElement('button'), { type: 'button', textContent: text, onclick });
const heading = text => Object.assign(document.createElement('h3'), { textContent: text });
const note = text => Object.assign(document.createElement('p'), { className: 'mp-note', textContent: text });
const go = url => location.assign(url);

const pseudo = Object.assign(document.createElement('input'), { maxLength: 15, autocomplete: 'nickname', placeholder: 'Unknown Soldier' });
pseudo.setAttribute('aria-label', 'Pseudo');
try { pseudo.value = localStorage.getItem('bo1z-name') ?? ''; } catch {}
pseudo.addEventListener('input', () => {
  pseudo.value = pseudo.value.replace(/[^\w-]/g, '').slice(0, 15);
  try { localStorage.setItem('bo1z-name', pseudo.value); } catch {}
});
const suggested = `salon-${crypto.randomUUID().slice(0, 4)}`;
const roomName = Object.assign(document.createElement('input'), { maxLength: 40, value: suggested, placeholder: suggested });
roomName.setAttribute('aria-label', 'Nom du nouveau salon');
const list = document.createElement('div');

let rooms = [];
function render() {
  const joined = rooms.find(({ name }) => name === room);
  row.textContent = !room ? 'Multijoueur' : joined ? `Rejoindre ${room} : ${MAPS[joined.map] ?? joined.map}` : `Salon ${room} : choisis ta carte`;
  row.onclick = joined ? () => go(`/bo1z/${joined.map}?room=${encodeURIComponent(room)}`) : () => { panel.hidden = !panel.hidden; };
  list.replaceChildren(...(rooms.length ? rooms.map(({ name, map, players }) =>
    button(`${name} · ${MAPS[map] ?? map} · ${players} joueur${players > 1 ? 's' : ''}`, () => go(`/bo1z/${map}?room=${encodeURIComponent(name)}`)))
    : [note('Aucun salon ouvert.')]));
}

panel.append(
  heading('Multijoueur'),
  heading('Pseudo'), pseudo,
  heading('Salons ouverts'), list,
  heading('Nouveau salon'), roomName,
  button('Créer, puis choisir la carte', () => go(`/bo1z?room=${encodeURIComponent(roomName.value.trim() || roomName.placeholder)}`)),
  note('Le créateur est l’hôte ; les autres rejoignent sa carte depuis cette liste ou son lien d’invitation.'),
  ...(room ? [
    button('Copier le lien d’invitation', () => navigator.clipboard?.writeText(`${location.origin}/bo1z?room=${encodeURIComponent(room)}`)),
    button('Quitter le salon', () => go('/bo1z')),
  ] : []),
  button('Retour', () => { panel.hidden = true; }),
);

async function refresh() {
  try {
    rooms = await (await fetch('/rooms', { cache: 'no-store' })).json();
    render();
  } catch {}
  if (document.body.contains(row)) setTimeout(refresh, 2000);
}
render();
refresh();
