import { createReadStream } from 'node:fs';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { cached, pick, upstream } from '../lib/cache.mjs';
import { udpBridge } from '../lib/net.mjs';
import { mapPage } from '../lib/pages.mjs';
import { signaling } from '../lib/signal.mjs';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 8484);
const NET_PORT = Number(process.env.NET_PORT ?? 3074);
const CACHE = process.env.CACHE !== '0';
const ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]');
const ROOT = path.join(import.meta.dirname, '..');
const OVERRIDES = path.join(ROOT, 'overrides');
const WEB = path.join(ROOT, 'web');
const TELEMETRY = path.join(ROOT, 'telemetry');
// Sans isolation cross-origin, pas de SharedArrayBuffer : les pthreads du moteur ne démarrent pas.
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const TYPES: Record<string, string> = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

const rooms = signaling(ICE_SERVERS);
const app = fastify();
app.removeAllContentTypeParsers();
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
app.setErrorHandler((error: Error, request, reply) => {
  console.error(request.method, request.url, error.message);
  return reply.code(502).send();
});

// telemetry.js n'envoie rien tant que sa sonde GET ne reçoit pas { enabled: true } : seule une page ouverte sur ce poste l'obtient.
// Sur Heroku, l'interlocuteur est toujours le routeur : chaque joueur y écrivait ses relevés sur le disque du serveur.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.route({
  method: ['GET', 'POST'], url: '/bo1z/telemetry',
  handler: async (request, reply) => {
    const local = LOOPBACK.has(request.socket.remoteAddress ?? '');
    if (request.method === 'GET') return reply.send({ enabled: local, build: 'bo1z-lan' });
    if (!local) return reply.code(403).send();
    await mkdir(TELEMETRY, { recursive: true });
    await appendFile(path.join(TELEMETRY, `${PORT}.jsonl`), `${request.body ?? ''}\n`);
    return reply.code(204).send();
  },
});

app.get('/rooms', async (request, reply) => {
  const { code } = request.query as { code?: string };
  return reply.header('cache-control', 'no-store').send(code === undefined ? rooms.list() : rooms.find(code));
});

app.get('/', async (request, reply) => reply.redirect(`/bo1z${new URL(request.url, 'http://127.0.0.1').search}`, 302));

// Vidéos de chargement (<video>) et reprise d'un fichier entier par download-worker.js : servies depuis le cache, hors ligne compris.
function byteRange(header: string | undefined, length: number) {
  const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(header ?? '') ?? [];
  if (!from && !to) return null;
  const start = from ? Number(from) : Math.max(0, length - Number(to));
  const end = from && to ? Math.min(Number(to), length - 1) : length - 1;
  return start <= end ? { start, end } : null;
}

// Le moteur patché par le build (overrides/) passe avant le site (web/, servi sous /bo1z/).
async function localFile(pathname: string) {
  const site = /^\/bo1z\/?$/.test(pathname) ? '/index.html' : pathname.startsWith('/bo1z/') && pathname.slice('/bo1z'.length);
  for (const file of [path.join(OVERRIDES, path.normalize(pathname)), ...(site ? [path.join(WEB, path.normalize(site))] : [])]) {
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return { file, size: info.size };
  }
  return null;
}

function serve(request: FastifyRequest, reply: FastifyReply, status: number, headers: Record<string, unknown>, body: Readable) {
  reply.code(status).headers({ ...headers, ...ISOLATION });
  if (request.method !== 'HEAD') return reply.send(body);
  body.destroy();
  return reply.send();
}

app.route({
  method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], url: '/*', exposeHeadRoute: false,
  handler: async (request, reply) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(405).send();
    const local = await localFile(url.pathname);
    if (local) return serve(request, reply, 200, { 'content-type': TYPES[path.extname(local.file)] ?? 'application/octet-stream', 'content-length': local.size }, createReadStream(local.file));
    const page = await mapPage(url.pathname);
    if (page) return serve(request, reply, 200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) }, Readable.from([page]));
    const headers = Object.fromEntries(['user-agent', 'accept-encoding'].filter(name => request.headers[name]).map(name => [name, request.headers[name]]));
    if (!CACHE) {
      const response = await upstream(url, request.headers.range ? { ...headers, range: request.headers.range } : headers);
      return serve(request, reply, response.statusCode, pick(response.headers), response);
    }
    // Le worker de vel.gg compare Content-Length à la taille attendue des fichiers téléchargés d'un seul bloc.
    const hit = (await cached(url, headers))!;
    if (!('file' in hit)) return serve(request, reply, hit.meta.status, hit.meta.headers, hit.body);
    const range = byteRange(request.headers.range, hit.length);
    if (!range) return serve(request, reply, hit.meta.status, { ...hit.meta.headers, 'content-length': hit.length }, hit.body);
    hit.body.destroy();
    return serve(request, reply, 206, { ...hit.meta.headers, 'content-range': `bytes ${range.start}-${range.end}/${hit.length}`, 'content-length': range.end - range.start + 1 },
      createReadStream(hit.file, { start: hit.start + range.start, end: hit.start + range.end }));
  },
});

const upgrades: Record<string, (request: unknown, socket: unknown) => void> = { '/signal': rooms.upgrade, ...(NET_PORT ? { '/kbnet': udpBridge(PORT, NET_PORT) } : {}) };
app.server.on('upgrade', (request, socket) => {
  const upgrade = upgrades[new URL(request.url ?? '/', 'http://127.0.0.1').pathname];
  if (upgrade) upgrade(request, socket);
  else socket.destroy();
});
await app.listen({ port: PORT, host: HOST });
console.log(`http://${HOST}:${PORT}/bo1z/`);
