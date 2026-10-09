import { readFile } from 'node:fs/promises';
import { cachePath, cachedBytes } from './cache.mjs';

const TEMPLATE = cachePath(new URL('/bo1z/map.html', 'http://127.0.0.1'));

let maps;
export async function mapList() {
  if (maps) return maps;
  const source = (await cachedBytes('/bo1z/maps.js')).toString();
  const first = source.match(/const FIRST = '(\w+)'/)[1];
  maps = [...source.matchAll(/\{ zone: '(\w+)', slug: '(\w+)', name: '([^']+)'[^}]*\}/g)]
    .map(([entry, zone, slug, name]) => ({ zone, slug, name, horde: /horde: true/.test(entry), first: zone === first }));
  return maps;
}

// Sans bo1z/map.html (cache rempli depuis vel.gg, sans la branche assets), la page vient de vel.gg comme le reste.
export async function mapPage(pathname) {
  const slug = /^\/bo1z\/(\w+)\/?$/.exec(pathname)?.[1];
  const template = slug && await readFile(TEMPLATE, 'utf8').catch(() => null);
  const map = template && (await mapList()).find(entry => entry.slug === slug);
  return map ? template.replaceAll('{{zone}}', map.zone).replaceAll('{{name}}', map.name) : null;
}
