import http from 'node:http';
import https from 'node:https';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { entryPath } from './lib/cache.mjs';

const UPSTREAM = 'vel.gg';
const PORT = Number(process.env.PORT ?? 8484);
const OVERRIDES = path.join(import.meta.dirname, 'overrides');
// Sans isolation cross-origin, pas de SharedArrayBuffer : les pthreads du moteur ne démarrent pas.
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const FORWARDED = ['content-type', 'content-encoding', 'content-range', 'accept-ranges', 'location'];
const TYPES = { '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.js': 'text/javascript' };

const pick = headers => Object.fromEntries(FORWARDED.filter(name => headers[name]).map(name => [name, headers[name]]));
const isFile = file => stat(file).then(info => info.isFile(), () => false);

const upstream = (url, headers) => new Promise((resolve, reject) =>
  https.get({ host: UPSTREAM, path: url.pathname + url.search, headers }, resolve).on('error', reject));

// Le cache n'expire jamais : un wasm patché doit rester apparié aux scripts et aux packs de sa version.
async function cached(url, headers) {
  const file = entryPath(url);
  try {
    return { meta: JSON.parse(await readFile(`${file}.json`, 'utf8')), body: createReadStream(file) };
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
  return { meta, body: createReadStream(file) };
}

async function serve(req, res, status, headers, body) {
  res.writeHead(status, { ...headers, ...ISOLATION });
  if (req.method === 'HEAD') {
    body.destroy();
    return res.end();
  }
  await pipeline(body, res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    // telemetry.js coupe tout envoi quand sa sonde ne reçoit pas de 200.
    if (url.pathname.endsWith('/telemetry')) return res.writeHead(404).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const override = path.join(OVERRIDES, path.normalize(url.pathname));
    if (await isFile(override)) {
      const type = TYPES[path.extname(override)] ?? 'application/octet-stream';
      return await serve(req, res, 200, { 'content-type': type }, createReadStream(override));
    }
    const headers = { 'user-agent': req.headers['user-agent'], 'accept-encoding': req.headers['accept-encoding'] };
    if (req.headers.range) {
      const response = await upstream(url, { ...headers, range: req.headers.range });
      return await serve(req, res, response.statusCode, pick(response.headers), response);
    }
    const { meta, body } = await cached(url, headers);
    await serve(req, res, meta.status, meta.headers, body);
  } catch (error) {
    console.error(req.method, url.pathname + url.search, error.message);
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/bo1z/`));
