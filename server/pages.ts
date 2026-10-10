import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAPS } from '../web/catalog.mjs';

const TEMPLATE = path.join(import.meta.dirname, '..', 'web', 'map.html');

export async function mapPage(pathname: string) {
  const slug = /^\/(\w+)\/?$/.exec(pathname)?.[1];
  const map = MAPS.find(entry => entry.slug === slug);
  return map ? (await readFile(TEMPLATE, 'utf8')).replaceAll('{{zone}}', map.zone).replaceAll('{{name}}', map.name) : null;
}
