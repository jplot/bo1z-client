import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { brotliDecompressSync } from 'node:zlib';
import { CHUNK, cachePath, cached, cachedBytes, upstream } from './lib/cache.mjs';

const HEADERS = { 'user-agent': 'Mozilla/5.0 (bo1z-lan build)', 'accept-encoding': 'br, gzip, zstd' };
const REF = /["'`](\.{0,2}\/?[\w./-]+\.(?:m?js|css|json|wasm|webp|png|svg|woff2?))["'`]/g;
const PARALLEL = 4;

const site = new Set();
const assets = new Set();
const absent = [];

async function crawl(urlPath, base = urlPath) {
  if (site.has(urlPath)) return;
  site.add(urlPath);
  let text;
  try { text = (await cachedBytes(urlPath)).toString(); } catch { return void absent.push(urlPath); }
  for (const [, ref] of text.matchAll(REF)) {
    const target = new URL(ref, `http://127.0.0.1${base}`).pathname;
    if (!target.startsWith('/bo1z/')) continue;
    if (/\.(m?js|css)$/.test(target)) await crawl(target);
    else assets.add(target);
  }
}

// download-worker.js : ?part=k si br compte un morceau par tranche, sinon d'un bloc ; un son Opus arrive en .kop
// (son SHA-256 est celui du .kop), plus le fichier d'origine pour les navigateurs sans AudioDecoder.
function packFiles(root, chunk, file) {
  if (file.dxs) throw new Error(`${file.path} : transport DXS non géré`);
  const pack = `${root}pack/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  const real = (url, { size, sha256, br }) => ({ url, size, sha256, parts: Array.isArray(br) && br.length === Math.ceil(size / chunk) ? br.length : 0 });
  if (file.opus && file.fallback && Array.isArray(file.br)) return [{ url: `${pack}.kop`, size: file.opus, sha256: file.sha256, parts: file.br.length }, real(pack, file.fallback)];
  return [real(pack, file)];
}

async function download({ url, parts }, file) {
  if (!parts) {
    const { meta, body } = await cached(new URL(url, 'http://127.0.0.1'), HEADERS);
    body.destroy();
    if (meta.status !== 200) throw new Error(`${url} : HTTP ${meta.status}`);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.hrtime.bigint()}.part`;
  const handle = await open(partial, 'w');
  try {
    for (let k = 0; k < parts; k++) {
      const response = await upstream(new URL(`${url}?part=${k}`, 'http://127.0.0.1'), HEADERS);
      if (response.statusCode !== 200) throw new Error(`${url}?part=${k} : HTTP ${response.statusCode}`);
      const raw = await buffer(response);
      await handle.write(response.headers['content-encoding'] === 'br' ? brotliDecompressSync(raw) : raw);
    }
  } finally {
    await handle.close();
  }
  await rename(partial, file);
}

async function store(spec) {
  const file = cachePath(new URL(spec.url, 'http://127.0.0.1'));
  if (!(await stat(file).then(info => info.size === spec.size, () => false))) await download(spec, file);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== spec.sha256) throw new Error(`${spec.url} : SHA-256 différent du manifeste`);
}

async function mapUrls({ zone, slug, horde }, first) {
  const root = zone === first ? '/bo1z/' : `/bo1z/${slug}/`;
  const urls = [
    `/bo1z/${slug}`,
    ...['row', 'hl', 'panel'].map(kind => `/bo1z/art/mapselect-${kind}-${slug}.webp`), `/bo1z/art/loadscreen_${zone}.webp`,
  ];
  const optional = [`/bo1z/artifacts/${slug}-programs.json`, `/bo1z/artifacts/${zone}-pipelines.json`];
  const files = [];
  const manifests = [`${root}manifest.json`];
  if (horde) manifests.push(`${root}pack/web-manifest-horde.json`);
  for (const manifestUrl of manifests) {
    const manifest = JSON.parse(await cachedBytes(manifestUrl));
    const chunk = manifest.transport?.encoding === 'br' ? manifest.transport.chunk : 0;
    if (chunk && chunk !== CHUNK) throw new Error(`${manifestUrl} : morceaux de ${chunk} octets, le relais découpe par ${CHUNK}`);
    urls.push(manifestUrl);
    files.push(...manifest.files.flatMap(file => packFiles(root, chunk, file)));
    files.push(...(manifest.streams ?? []).map(({ path: streamPath, size, sha256 }) => ({ url: `${root}pack/${streamPath}`, size, sha256, parts: 0 })));
  }
  return { urls, optional, files };
}

async function fetchUrl(url, required) {
  const { meta, body } = await cached(new URL(url, 'http://127.0.0.1'), HEADERS);
  body.destroy();
  if (meta.status === 200) return;
  if (required) throw new Error(`${url} : HTTP ${meta.status}`);
  absent.push(url);
}

async function runAll(tasks) {
  let done = 0;
  const queue = [...tasks];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let task; (task = queue.shift());) {
      await task();
      if (++done % 50 === 0 || done === tasks.length) console.log(`${done}/${tasks.length} fichiers`);
    }
  }));
}

const maps = (await cachedBytes('/bo1z/maps.js')).toString();
const first = maps.match(/const FIRST = '(\w+)'/)[1];
const list = [...maps.matchAll(/\{ zone: '(\w+)', slug: '(\w+)'[^}]*\}/g)].map(([entry, zone, slug]) => ({ zone, slug, horde: /horde: true/.test(entry) }));
console.log(`${list.length} cartes : ${list.map(map => map.slug).join(', ')}`);

await crawl('/bo1z', '/bo1z/');
for (const { slug } of list) await crawl(`/bo1z/${slug}`, '/bo1z/');
const urls = [...site], optional = [...assets], files = new Map();
for (const map of list) {
  const found = await mapUrls(map, first);
  urls.push(...found.urls);
  optional.push(...found.optional);
  for (const spec of found.files) files.set(spec.url, spec);
}
urls.push(...['row', 'hl'].flatMap(kind => ['off', 'on'].map(state => `/bo1z/art/mapselect-${kind}-horde-${state}.webp`)));
await runAll([
  ...[...new Set(urls)].filter(url => !absent.includes(url)).map(url => () => fetchUrl(url, true)),
  ...optional.map(url => () => fetchUrl(url, false)),
  ...[...files.values()].map(spec => () => store(spec)),
]);
const total = [...files.values()].reduce((sum, { size }) => sum + size, 0);
console.log(`${files.size} fichiers de jeu vérifiés (SHA-256 des manifestes), ${(total / 1e9).toFixed(2)} Go`);
console.log(`absents chez vel.gg : ${absent.join(', ') || 'aucun'}`);
