import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { cached, pick, upstream } from './lib/cache.mjs';
import { udpBridge } from './lib/net.mjs';
import { mapPage } from './lib/pages.mjs';
import { signaling } from './lib/signal.mjs';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 8484);
const NET_PORT = Number(process.env.NET_PORT ?? 3074);
const CACHE = process.env.CACHE !== '0';
const PASSWORD = process.env.BO1Z_PASSWORD;
const ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]');
const OVERRIDES = path.join(import.meta.dirname, 'overrides');
const TELEMETRY = path.join(import.meta.dirname, 'telemetry');
// Sans isolation cross-origin, pas de SharedArrayBuffer : les pthreads du moteur ne démarrent pas.
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const TYPES = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const rooms = signaling(ICE_SERVERS);
const digest = text => createHash('sha256').update(text).digest();
const authorized = req => !PASSWORD
  || timingSafeEqual(digest(Buffer.from(req.headers.authorization?.split(' ')[1] ?? '', 'base64').toString().replace(/^[^:]*:/, '')), digest(PASSWORD));

// telemetry.js n'envoie rien tant que sa sonde GET ne reçoit pas { enabled: true } ; ses envois restent sur ce poste.
async function telemetry(req, res) {
  if (req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"enabled":true,"build":"bo1z-lan"}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  await mkdir(TELEMETRY, { recursive: true });
  await appendFile(path.join(TELEMETRY, `${PORT}.jsonl`), `${Buffer.concat(chunks)}\n`);
  res.writeHead(204).end();
}

// Vidéos de chargement (<video>) et reprise d'un fichier entier par download-worker.js : servies depuis le cache, hors ligne compris.
function byteRange(header, length) {
  const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(header ?? '') ?? [];
  if (!from && !to) return null;
  const start = from ? Number(from) : Math.max(0, length - Number(to));
  const end = from && to ? Math.min(Number(to), length - 1) : length - 1;
  return start <= end ? { start, end } : null;
}

async function serve(req, res, status, headers, body) {
  res.writeHead(status, { ...headers, ...ISOLATION });
  if (req.method === 'HEAD') {
    body.destroy();
    return res.end();
  }
  await pipeline(body, res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (!authorized(req)) return res.writeHead(401, { 'www-authenticate': 'Basic realm="bo1z"' }).end();
    if (url.pathname.endsWith('/telemetry')) return await telemetry(req, res);
    if (url.pathname === '/rooms') return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(rooms.list()));
    if (url.pathname === '/') return res.writeHead(302, { location: `/bo1z${url.search}` }).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const override = path.join(OVERRIDES, path.normalize(url.pathname));
    const info = await stat(override).catch(() => null);
    if (info?.isFile()) {
      const type = TYPES[path.extname(override)] ?? 'application/octet-stream';
      return await serve(req, res, 200, { 'content-type': type, 'content-length': info.size }, createReadStream(override));
    }
    const page = CACHE && await mapPage(url.pathname);
    if (page) return await serve(req, res, 200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) }, Readable.from([page]));
    const headers = { 'user-agent': req.headers['user-agent'], 'accept-encoding': req.headers['accept-encoding'] };
    if (!CACHE) {
      const response = await upstream(url, req.headers.range ? { ...headers, range: req.headers.range } : headers);
      return await serve(req, res, response.statusCode, pick(response.headers), response);
    }
    // Le worker de vel.gg compare Content-Length à la taille attendue des fichiers téléchargés d'un seul bloc.
    const { meta, body, file, start, length } = await cached(url, headers);
    const range = length !== undefined && !meta.headers['content-encoding'] && byteRange(req.headers.range, length);
    if (!range) return await serve(req, res, meta.status, length === undefined ? meta.headers : { ...meta.headers, 'content-length': length }, body);
    body.destroy();
    await serve(req, res, 206, { ...meta.headers, 'content-range': `bytes ${range.start}-${range.end}/${length}`, 'content-length': range.end - range.start + 1 }, createReadStream(file, { start: start + range.start, end: start + range.end }));
  } catch (error) {
    console.error(req.method, url.pathname + url.search, error.message);
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end();
  }
});

const upgrades = { '/signal': rooms.upgrade, ...(NET_PORT ? { '/kbnet': udpBridge(PORT, NET_PORT) } : {}) };
server.on('upgrade', (req, socket) => {
  const upgrade = upgrades[new URL(req.url, 'http://127.0.0.1').pathname];
  if (upgrade) upgrade(req, socket);
  else socket.destroy();
});
server.listen(PORT, HOST, () => console.log(`http://${HOST}:${PORT}/bo1z/`));
