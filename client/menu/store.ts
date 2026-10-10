import { shallowReactive } from 'vue';
import { MAPS, type GameMap } from '../catalog.ts';

export type { GameMap };
export type Room = { name: string; map: string; private?: boolean; players: number; members: { label: string; pseudo: string }[] };

export const HOST = '10.0.0.1';
export const ERA: Record<string, string> = { 'World at War': 'waw', 'Black Ops': 'bo' };
const HELL_KEY = 'bo1z-horde';
// Que des consonnes : aucun mot ne peut se former, et pas de O ni de I à confondre avec 0 et 1.
const CODE = 'BCDFGHJKLMNPQRSTVWXZ';

export const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
export const art = (map: GameMap) => `art/loadscreen_${map.zone}.webp`;
export const panel = (map: GameMap) => `art/mapselect-panel-${map.slug}.webp`;
export const bySlug = (slug: string) => MAPS.find(map => map.slug === slug);
export const isFull = (room: Room) => room.players >= 4;
export const flag = (on: boolean) => (on ? 'true' : 'false');
const mapUrl = (map: GameMap, params: Record<string, string> = {}) => `${map.slug}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;

export const state = shallowReactive({
  tab: 'solo' as 'solo' | 'multi', picking: false, hidden: false, hell: read(HELL_KEY) === '1', view: 'grid' as 'grid' | 'list',
  rooms: [] as Room[], selected: null as GameMap | null, hovering: false, backdrop: null as GameMap | null,
});

export const off = (map: GameMap) => state.hell && !map.horde && !state.picking;

export function setHell(on: boolean) {
  state.hell = on;
  write(HELL_KEY, on ? '1' : '0');
}

function go(map: GameMap, params: Record<string, string>) {
  location.assign(mapUrl(map, params));
}

export async function lookup(code: string): Promise<Room | null> {
  try {
    const response = await fetch(`/rooms?code=${code}`, { cache: 'no-store' });
    return response.ok ? (await response.json())[0] ?? null : null;
  } catch {
    return null;
  }
}

// Le premier arrivé d'un salon en est l'hôte : un code déjà pris ferait rejoindre la partie d'un autre, sur sa carte.
async function createRoom(map: GameMap) {
  let name;
  do name = Array.from({ length: 4 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join('');
  while (await lookup(name));
  go(map, { room: name, ...(state.hidden && { private: '1' }) });
}

export function pick(map: GameMap) {
  if (off(map)) return;
  if (state.picking) createRoom(map);
  else go(map, state.hell && map.horde ? { horde: '1' } : {});
}

export function join(room: Room) {
  const map = bySlug(room.map);
  if (map && !isFull(room)) go(map, { room: room.name, ...(room.private && { private: '1' }) });
}

let clearTimer = 0;
export function hover(map: GameMap) {
  clearTimeout(clearTimer);
  state.hovering = true;
  state.backdrop = map;
}

export function unhover() {
  clearTimer = setTimeout(() => {
    state.hovering = false;
    state.selected = null;
  }, 120);
}

export function select(map: GameMap) {
  hover(map);
  state.selected = map;
}

export function startPicking() {
  state.picking = true;
  state.hidden = false;
  state.tab = 'solo';
}

export function stopPicking() {
  state.picking = false;
  state.tab = 'multi';
}
