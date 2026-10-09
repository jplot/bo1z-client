import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { relay } from './relay.mjs';

const ENTRY = path.join(new URL('..', import.meta.url).pathname, 'cache', 'kbnet-test', 'whole.iwd@');
const URL_PATH = 'http://127.0.0.1:8615/kbnet-test/whole.iwd';
let child;

before(async () => {
  await mkdir(path.dirname(ENTRY), { recursive: true });
  await writeFile(ENTRY, Buffer.alloc(123_456, 7));
  await writeFile(`${ENTRY}.json`, JSON.stringify({ status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  child = await relay(8615, 0);
});

after(async () => {
  child.kill();
  await rm(path.dirname(ENTRY), { recursive: true, force: true });
});

test('un fichier servi depuis le cache annonce sa longueur exacte (le worker de vel.gg la vérifie)', async () => {
  const response = await fetch(URL_PATH);
  assert.equal(response.headers.get('content-length'), '123456');
  assert.equal((await response.arrayBuffer()).byteLength, 123_456);
});

test('une reprise par plage est servie depuis le cache', async () => {
  const response = await fetch(URL_PATH, { headers: { range: 'bytes=123000-' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 123000-123455/123456');
  assert.equal((await response.arrayBuffer()).byteLength, 456);
});

test('le nom du salon ne change pas l’entrée de cache', async () => {
  const response = await fetch(`${URL_PATH}?room=soiree`);
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 123_456);
});
