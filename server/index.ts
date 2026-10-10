import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import type { OutgoingHttpHeaders } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { udpBridge } from './bridge.ts';
import { cached, pick, upstream } from './cache.ts';
import { mapPage } from './pages.ts';
import { rooms } from './rooms.ts';

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

const app = fastify();
// Une trame WebSocket porte au plus un datagramme UDP (65 507 octets) et son en-tête de 6 octets.
await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
// Le moteur patché par le build (overrides/) passe avant le site (web/, servi sous /bo1z/).
await app.register(fastifyStatic, {
  root: [path.join(OVERRIDES, 'bo1z'), WEB], prefix: '/bo1z/',
  setHeaders: reply => { reply.headers(ISOLATION); },
});
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

rooms(app, ICE_SERVERS);
if (NET_PORT) udpBridge(app, PORT, NET_PORT);

app.get('/', async (request, reply) => reply.redirect(`/bo1z${new URL(request.url, 'http://127.0.0.1').search}`, 302));
app.get('/bo1z', async (_request, reply) => reply.sendFile('index.html', WEB));

// Vidéos de chargement (<video>) et reprise d'un fichier entier par download-worker.js : servies depuis le cache, hors ligne compris.
function byteRange(header: string | undefined, length: number) {
  const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(header ?? '') ?? [];
  if (!from && !to) return null;
  const start = from ? Number(from) : Math.max(0, length - Number(to));
  const end = from && to ? Math.min(Number(to), length - 1) : length - 1;
  return start <= end ? { start, end } : null;
}

function serve(request: FastifyRequest, reply: FastifyReply, status: number, headers: OutgoingHttpHeaders, body: Readable) {
  reply.code(status).headers({ ...headers, ...ISOLATION });
  if (request.method !== 'HEAD') return reply.send(body);
  body.destroy();
  return reply.send();
}

// Ce que @fastify/static ne trouve pas : pages de carte, puis données du jeu (cache local, ou vel.gg en passage direct).
app.setNotFoundHandler(async (request, reply) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(405).send();
  const page = await mapPage(url.pathname);
  if (page) return serve(request, reply, 200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) }, Readable.from([page]));
  const headers = Object.fromEntries(['user-agent', 'accept-encoding'].filter(name => request.headers[name]).map(name => [name, request.headers[name]]));
  if (!CACHE) {
    const response = await upstream(url, request.headers.range ? { ...headers, range: request.headers.range } : headers);
    return serve(request, reply, response.statusCode!, pick(response.headers), response);
  }
  // Le worker de vel.gg compare Content-Length à la taille attendue des fichiers téléchargés d'un seul bloc.
  const hit = await cached(url, headers);
  if (!('file' in hit)) return serve(request, reply, hit.meta.status, hit.meta.headers, hit.body);
  const range = byteRange(request.headers.range, hit.length);
  if (!range) return serve(request, reply, hit.meta.status, { ...hit.meta.headers, 'content-length': hit.length }, hit.body);
  hit.body.destroy();
  return serve(request, reply, 206, { ...hit.meta.headers, 'content-range': `bytes ${range.start}-${range.end}/${hit.length}`, 'content-length': range.end - range.start + 1 },
    createReadStream(hit.file, { start: hit.start + range.start, end: hit.start + range.end }));
});

await app.listen({ port: PORT, host: HOST });
console.log(`http://${HOST}:${PORT}/bo1z/`);
