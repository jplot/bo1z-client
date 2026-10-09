import https from 'node:https';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib';

const UPSTREAM = 'vel.gg';
const CACHE = path.join(import.meta.dirname, '..', 'cache');
const FORWARDED = ['content-type', 'content-encoding', 'content-length', 'content-range', 'accept-ranges', 'location'];
const DECODERS = { br: brotliDecompressSync, gzip: gunzipSync, zstd: zstdDecompressSync };

// room et connect ne servent qu'à kbnet.js : vel.gg renvoie la même page, et un salon inédit doit se charger hors ligne.
const OWN_PARAMS = ['room', 'connect'];

// Suffixe '@' : /bo1z (fichier) et /bo1z/five (dossier bo1z) coexistent sur disque.
function entryPath(url) {
  const query = new URLSearchParams(url.search);
  for (const name of OWN_PARAMS) query.delete(name);
  return path.join(CACHE, path.normalize(url.pathname)) + '@' + encodeURIComponent(query.toString());
}

export const pick = headers => Object.fromEntries(FORWARDED.filter(name => headers[name]).map(name => [name, headers[name]]));

export const upstream = (url, headers) => new Promise((resolve, reject) =>
  https.get({ host: UPSTREAM, path: url.pathname + url.search, headers }, resolve).on('error', reject));

// Le cache n'expire jamais : un wasm patché doit rester apparié aux scripts et aux packs de sa version.
export async function cached(url, headers) {
  const file = entryPath(url);
  try {
    return { meta: JSON.parse(await readFile(`${file}.json`, 'utf8')), body: createReadStream(file), file, length: (await stat(file)).size };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await upstream(url, headers);
  const meta = { status: response.statusCode, headers: pick(response.headers) };
  if (meta.status !== 200) return { meta, body: response };
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.hrtime.bigint()}.part`;
  await pipeline(response, createWriteStream(partial));
  await rename(partial, file);
  await writeFile(`${file}.json`, JSON.stringify(meta));
  return { meta, body: createReadStream(file), file, length: (await stat(file)).size };
}

export async function cachedBytes(urlPath) {
  const { meta, body } = await cached(new URL(urlPath, 'http://127.0.0.1'), { 'user-agent': 'Mozilla/5.0 (bo1z-lan build)', 'accept-encoding': 'br, gzip, zstd' });
  if (meta.status !== 200) throw new Error(`${urlPath} : HTTP ${meta.status}`);
  const raw = await buffer(body);
  const encoding = meta.headers['content-encoding'];
  return encoding ? DECODERS[encoding](raw) : raw;
}
