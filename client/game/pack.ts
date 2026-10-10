import { MAPS } from '../catalog.ts';

// Map pages are served at <prefix><slug>: their directory is the site root, whatever the prefix.
export const BASE = new URL('.', location.href).pathname;
export const map = MAPS.find(entry => entry.zone === document.documentElement.dataset.map) ?? MAPS.find(entry => entry.first)!;
const query = new URLSearchParams(location.search);
export const horde = query.get('horde') === '1' && Boolean(map.horde);
export const room = query.get('room');
export const hiddenRoom = query.get('private') === '1';
export const connectTo = query.get('connect');

// Five keeps the root and the "pack" OPFS directory from before the other maps: its players re-download nothing.
const root = map.first ? BASE : `${BASE}${map.slug}/`;
export const packBase = `${root}pack/`;
export const opfsRoot = `/opfs/${map.first ? 'pack' : `pack-${map.slug}`}/files`;
export const programsUrl = `${BASE}artifacts/${map.slug}-programs.json`;
