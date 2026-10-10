import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import type { OutgoingHttpHeaders } from 'node:http';
import { BlockList, isIPv6 } from 'node:net';
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
const TRIMMED = (process.env.PREFIX ?? '').replace(/^\/+|\/+$/g, '');
const PREFIX = TRIMMED ? `/${TRIMMED}/` : '/';
const ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]');
const ROOT = path.join(import.meta.dirname, '..');
const OVERRIDES = path.join(ROOT, 'overrides');
const DIST = path.join(ROOT, 'dist');
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
// Le moteur patché par le build (overrides/) passe avant le site compilé (dist/, npm run build).
await app.register(fastifyStatic, {
  root: [path.join(OVERRIDES, 'bo1z'), DIST], prefix: PREFIX,
  setHeaders: reply => { reply.headers(ISOLATION); },
});
app.removeAllContentTypeParsers();
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
app.setErrorHandler((error: Error, request, reply) => {
  console.error(request.method, request.url, error.message);
  return reply.code(502).send();
});

// telemetry.js n'envoie rien tant que sa sonde GET ne reçoit pas { enabled: true } : seule une page ouverte sur ce poste l'obtient,
// ou toute page avec TELEMETRY=1 (relais lancé chez soi pour les joueurs du réseau local ; le Procfile ne le pose pas).
// Sur Heroku, l'interlocuteur est toujours le routeur : chaque joueur y écrivait ses relevés sur le disque du serveur.
const TELEMETRY_ALL = process.env.TELEMETRY === '1';
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
app.route({
  method: ['GET', 'POST'], url: `${PREFIX}telemetry`,
  handler: async (request, reply) => {
    const address = request.socket.remoteAddress ?? '';
    const local = TELEMETRY_ALL || LOOPBACK.check(address, isIPv6(address) ? 'ipv6' : 'ipv4');
    if (request.method === 'GET') return reply.send({ enabled: local, build: 'bo1z-lan' });
    if (!local) return reply.code(403).send();
    await mkdir(TELEMETRY, { recursive: true });
    await appendFile(path.join(TELEMETRY, `${PORT}.jsonl`), `${request.body ?? ''}\n`);
    return reply.code(204).send();
  },
});

rooms(app, ICE_SERVERS);
if (NET_PORT) udpBridge(app, PORT, NET_PORT);

// Redirections temporaires : le préfixe peut changer, un 301 resterait dans le navigateur. Les adresses en /bo1z/ d'avant
// le préfixe réglable (liens de salon partagés compris) mènent à la même page sous PREFIX.
const under = (from: string) => async (request: FastifyRequest, reply: FastifyReply) => reply.redirect(`${PREFIX}${request.url.slice(from.length).replace(/^\//, '')}`, 302);
if (PREFIX !== '/') {
  app.get('/', under('/'));
  app.get(PREFIX.slice(0, -1), under(PREFIX.slice(0, -1)));
}
if (PREFIX !== '/bo1z/') {
  app.get('/bo1z', under('/bo1z'));
  app.get('/bo1z/*', under('/bo1z'));
}

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
  if (!url.pathname.startsWith(PREFIX)) return reply.code(404).send();
  const site = url.pathname.slice(PREFIX.length - 1);
  const page = await mapPage(site);
  if (page) return serve(request, reply, 200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) }, Readable.from([page]));
  // Chez vel.gg, et donc dans cache/, tout vit sous /bo1z/.
  const remote = new URL(`/bo1z${site}${url.search}`, 'http://127.0.0.1');
  const headers = Object.fromEntries(['user-agent', 'accept-encoding'].filter(name => request.headers[name]).map(name => [name, request.headers[name]]));
  if (!CACHE) {
    const response = await upstream(remote, request.headers.range ? { ...headers, range: request.headers.range } : headers);
    return serve(request, reply, response.statusCode!, pick(response.headers), response);
  }
  // Le worker de vel.gg compare Content-Length à la taille attendue des fichiers téléchargés d'un seul bloc.
  const hit = await cached(remote, headers);
  if (!('file' in hit)) return serve(request, reply, hit.meta.status, hit.meta.headers, hit.body);
  const range = byteRange(request.headers.range, hit.length);
  if (!range) return serve(request, reply, hit.meta.status, { ...hit.meta.headers, 'content-length': hit.length }, hit.body);
  hit.body.destroy();
  return serve(request, reply, 206, { ...hit.meta.headers, 'content-range': `bytes ${range.start}-${range.end}/${hit.length}`, 'content-length': range.end - range.start + 1 },
    createReadStream(hit.file, { start: hit.start + range.start, end: hit.start + range.end }));
});

await app.listen({ port: PORT, host: HOST });
console.log(`http://${HOST}:${PORT}${PREFIX}`);
