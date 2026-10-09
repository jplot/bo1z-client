import { cached, cachedBytes } from './lib/cache.mjs';

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

// download-worker.js : parties Brotli ?part=k si br compte une partie par bloc de transport, sinon fichier entier ;
// sons Opus en .kop?part=k plus les parties d'origine (navigateur sans AudioDecoder) ; IWD DXS en .dxs?part=k.
function packUrls(root, chunk, file) {
  const pack = `${root}pack/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  const parts = (suffix, count) => Array.from({ length: count }, (_, k) => `${pack}${suffix}?part=${k}`);
  const plain = ({ size, br }) => (Array.isArray(br) && br.length === Math.ceil(size / chunk) ? parts('', br.length) : [pack]);
  if (file.opus && file.fallback && Array.isArray(file.br)) return [...parts('.kop', file.br.length), ...plain(file.fallback)];
  if (file.dxs && Array.isArray(file.br) && file.br.length === Math.ceil(file.dxs / chunk)) return parts('.dxs', file.br.length);
  return plain(file);
}

async function mapUrls({ zone, slug, horde }, first) {
  const root = zone === first ? '/bo1z/' : `/bo1z/${slug}/`;
  const query = [zone === first ? '' : `map=${zone}`, 'packOrigin=0'].filter(Boolean).join('&');
  const urls = [
    `/bo1z/${slug}`, `/bo1z/engine-download-worker.js?${query}`,
    ...['row', 'hl', 'panel'].map(kind => `/bo1z/art/mapselect-${kind}-${slug}.webp`), `/bo1z/art/loadscreen_${zone}.webp`,
  ];
  const optional = [`/bo1z/artifacts/${slug}-programs.json`, `/bo1z/artifacts/${zone}-pipelines.json`];
  const manifests = [`${root}manifest.json`];
  if (horde) {
    urls.push(`/bo1z/engine-download-worker.js?${query.replace('packOrigin', 'mode=horde&packOrigin')}`);
    manifests.push(`${root}pack/web-manifest-horde.json`);
  }
  for (const manifestUrl of manifests) {
    const manifest = JSON.parse(await cachedBytes(manifestUrl));
    const chunk = manifest.transport?.encoding === 'br' ? manifest.transport.chunk : 0;
    urls.push(manifestUrl, ...manifest.files.flatMap(file => packUrls(root, chunk, file)));
    urls.push(...(manifest.streams ?? []).map(stream => `${root}pack/${stream.path}`));
  }
  return { urls, optional };
}

async function fetchAll(urls, optional) {
  let done = 0, bytes = 0;
  const queue = [...new Set(urls)].map(url => ({ url, required: true })).concat(optional.map(url => ({ url, required: false })));
  const total = queue.length;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let item; (item = queue.shift());) {
      const { meta, body, length } = await cached(new URL(item.url, 'http://127.0.0.1'), HEADERS);
      body.destroy();
      if (meta.status !== 200 && item.required) throw new Error(`${item.url} : HTTP ${meta.status}`);
      if (meta.status !== 200) absent.push(item.url);
      bytes += length ?? 0;
      if (++done % 50 === 0 || done === total) console.log(`${done}/${total} fichiers, ${(bytes / 1e9).toFixed(2)} Go`);
    }
  }));
}

const maps = (await cachedBytes('/bo1z/maps.js')).toString();
const first = maps.match(/const FIRST = '(\w+)'/)[1];
const list = [...maps.matchAll(/\{ zone: '(\w+)', slug: '(\w+)'[^}]*\}/g)].map(([entry, zone, slug]) => ({ zone, slug, horde: /horde: true/.test(entry) }));
console.log(`${list.length} cartes : ${list.map(map => map.slug).join(', ')}`);

await crawl('/bo1z', '/bo1z/');
for (const { slug } of list) await crawl(`/bo1z/${slug}`, '/bo1z/');
const urls = [...site], optional = [...assets];
for (const map of list) {
  const found = await mapUrls(map, first);
  urls.push(...found.urls);
  optional.push(...found.optional);
}
urls.push(...['row', 'hl'].flatMap(kind => ['off', 'on'].map(state => `/bo1z/art/mapselect-${kind}-horde-${state}.webp`)));
await fetchAll(urls.filter(url => !absent.includes(url)), optional);
console.log(`absents chez vel.gg : ${absent.join(', ') || 'aucun'}`);
