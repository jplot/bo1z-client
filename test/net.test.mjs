import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;

function relay(httpPort, udpPort) {
  const child = spawn(process.execPath, ['proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(httpPort), NET_PORT: String(udpPort) },
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes(`UDP ${udpPort} :`) && output.includes(`:${httpPort}/bo1z/`)) resolve(child);
    });
    child.on('exit', code => reject(new Error(`relais ${httpPort} arrêté (${code})`)));
  });
}

function page(httpPort, origin = `http://127.0.0.1:${httpPort}`) {
  const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/kbnet`, { headers: { origin } });
  socket.binaryType = 'arraybuffer';
  return socket;
}

function datagram(port, text) {
  const bytes = Buffer.alloc(6 + text.length);
  bytes.set([127, 0, 0, 1]);
  bytes.writeUInt16BE(port, 4);
  bytes.write(text, 6);
  return bytes;
}

async function received(socket) {
  const [{ data }] = await once(socket, 'message');
  const bytes = Buffer.from(data);
  return { from: `${[...bytes.subarray(0, 4)].join('.')}:${bytes.readUInt16BE(4)}`, text: bytes.subarray(6).toString() };
}

test('un datagramme traverse les deux relais et arrive avec le port UDP de l’émetteur', async t => {
  const relays = await Promise.all([relay(8601, 29601), relay(8602, 29602)]);
  t.after(() => relays.forEach(child => child.kill()));
  const [host, client] = [page(8601), page(8602)];
  await Promise.all([once(host, 'open'), once(client, 'open')]);

  client.send(datagram(29601, 'getchallenge'));
  assert.deepEqual(await received(host), { from: '127.0.0.1:29602', text: 'getchallenge' });

  host.send(datagram(29602, 'challengeResponse'));
  assert.deepEqual(await received(client), { from: '127.0.0.1:29601', text: 'challengeResponse' });

  host.close();
  client.close();
});

test('une page d’une autre origine ne peut pas ouvrir le pont', async t => {
  const child = await relay(8603, 29603);
  t.after(() => child.kill());
  const socket = page(8603, 'https://example.com');
  const [event] = await Promise.race([once(socket, 'error'), once(socket, 'open')]);
  assert.equal(event.type, 'error');
});
