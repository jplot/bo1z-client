import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import { brotliDecompressSync, createBrotliDecompress, createGunzip, createZstdDecompress, gunzipSync, zstdDecompressSync } from 'node:zlib';

const UPSTREAM = 'vel.gg';
const CACHE = path.join(import.meta.dirname, '..', 'cache');
const FORWARDED = ['content-type', 'content-encoding', 'content-length', 'content-range', 'accept-ranges', 'location'];
const DECODERS: Record<string, (data: Buffer) => Buffer> = { br: brotliDecompressSync, gzip: gunzipSync, zstd: zstdDecompressSync };
const STREAM_DECODERS: Record<string, () => NodeJS.ReadWriteStream> = { br: createBrotliDecompress, gzip: createGunzip, zstd: createZstdDecompress };
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.webp': 'image/webp', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

type Meta = { status: number; headers: OutgoingHttpHeaders };
type Hit = { meta: Meta; body: ReadStream; file: string; start: number; length: number };
type Passed = { meta: Meta; body: IncomingMessage };

// ?part=k est la tranche k de CHUNK octets (transport.chunk des manifestes de vel.gg), servie en clair : download-worker.js
// n'attend que ses octets. Le reste de la query est ignoré : les 17 variantes ?map=… d'engine-download-worker.js sont identiques.
export const CHUNK = 8 * 1024 * 1024;

export const cachePath = (url: URL) => path.join(CACHE, path.normalize(url.pathname));

function locate(url: URL) {
  const part = url.searchParams.get('part');
  if (part !== null && !/^\d+$/.test(part)) return null;
  return { base: cachePath(url), part: part === null ? null : Number(part) };
}

async function fromDisk({ base, part }: { base: string; part: number | null }): Promise<Hit | null> {
  const directory = await stat(base).then(info => info.isDirectory(), () => false);
  const file = part === null && directory ? path.join(base, 'index.html') : base;
  const size = await stat(file).then(info => (info.isFile() ? info.size : null), () => null);
  const start = part === null ? 0 : part * CHUNK;
  if (size === null || (part !== null && start >= size)) return null;
  const length = part === null ? size : Math.min(CHUNK, size - start);
  return {
    meta: { status: 200, headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' } },
    body: createReadStream(file, part === null ? {} : { start, end: start + length - 1 }), file, start, length,
  };
}

export const pick = (headers: IncomingHttpHeaders): OutgoingHttpHeaders => Object.fromEntries(FORWARDED.filter(name => headers[name]).map(name => [name, headers[name]]));

export const upstream = (url: URL, headers: OutgoingHttpHeaders) => new Promise<IncomingMessage>((resolve, reject) =>
  https.get({ host: UPSTREAM, path: url.pathname + url.search, headers }, resolve).on('error', reject));

// Le cache n'expire jamais : un wasm patché doit rester apparié aux scripts et aux packs de sa version.
// Un morceau seul ne s'y range pas : prefetch.ts reconstitue le fichier entier et vérifie son SHA-256.
export async function cached(url: URL, headers: OutgoingHttpHeaders): Promise<Hit | Passed> {
  const entry = locate(url);
  const hit = entry && await fromDisk(entry);
  if (hit) return hit;
  const response = await upstream(url, headers);
  const meta = { status: response.statusCode!, headers: pick(response.headers) };
  const encoding = response.headers['content-encoding'];
  if (!entry || entry.part !== null || meta.status !== 200 || (encoding && !STREAM_DECODERS[encoding])) return { meta, body: response };
  const file = response.headers['content-type']?.startsWith('text/html') ? path.join(entry.base, 'index.html') : entry.base;
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.hrtime.bigint()}.part`;
  if (encoding) await pipeline(response, STREAM_DECODERS[encoding](), createWriteStream(partial));
  else await pipeline(response, createWriteStream(partial));
  await rename(partial, file);
  return (await fromDisk(entry))!;
}

export async function cachedBytes(urlPath: string) {
  const { meta, body } = await cached(new URL(urlPath, 'http://127.0.0.1'), { 'user-agent': 'Mozilla/5.0 (bo1z-lan build)', 'accept-encoding': 'br, gzip, zstd' });
  if (meta.status !== 200) throw new Error(`${urlPath} : HTTP ${meta.status}`);
  const raw = await buffer(body);
  const encoding = meta.headers['content-encoding'];
  return typeof encoding === 'string' ? DECODERS[encoding](raw) : raw;
}
