import assert from 'node:assert/strict';
import test from 'node:test';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { MAILBOX_BYTES, post, push, receive, RING_BYTES, SOCKS, take } from '../web/ring.js';

const PACKETS = 100_000;
const packet = (sock, seq) => {
  const data = new Uint8Array(4 + ((seq * 31) % 1200));
  new DataView(data.buffer).setUint32(0, seq, true);
  for (let i = 4; i < data.length; i++) data[i] = (seq + sock + i) & 0xff;
  return { address: Uint8Array.of(seq, seq >> 8, seq >> 16, sock, seq & 0x7f, 3), data };
};

function produce(rings) {
  for (let seq = 0; seq < PACKETS; seq++) {
    for (let sock = 0; sock < SOCKS; sock++) {
      const { address, data } = packet(sock, seq);
      while (!push(rings, sock, address, data));
    }
  }
}

function consume(rings, sock) {
  for (let seq = 0; seq < PACKETS;) {
    let address;
    let data;
    if (!take(rings, sock, (from, bytes) => { address = from.slice(); data = bytes.slice(); })) continue;
    const expected = packet(sock, seq);
    if (!address.every((byte, i) => byte === expected.address[i]) || data.length !== expected.data.length
      || !data.every((byte, i) => byte === expected.data[i])) return `sock ${sock} : paquet ${seq} corrompu`;
    seq++;
  }
  return null;
}

const COMMANDS = 50_000;
const command = seq => new TextEncoder().encode(`set kbnet_${seq} ${'x'.repeat(seq % 900)}`);

function write(mailbox) {
  for (let seq = 0; seq < COMMANDS; seq++) while (!post(mailbox, command(seq)));
}

function read(mailbox) {
  for (let seq = 0; seq < COMMANDS;) {
    let text;
    if (!receive(mailbox, bytes => { text = bytes.slice(); })) continue;
    const expected = command(seq);
    if (text.length !== expected.length || !text.every((byte, i) => byte === expected[i])) return `commande ${seq} corrompue`;
    seq++;
  }
  return null;
}

const ROLES = { produce, consume, write, read };

if (!isMainThread) {
  const { role, shared, sock } = workerData;
  parentPort.postMessage(ROLES[role](shared, sock) ?? null);
} else {
  async function race(t, shared, roles) {
    const workers = [];
    t.after(() => workers.forEach(worker => worker.terminate()));
    const run = data => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { shared, ...data } });
      workers.push(worker);
      worker.once('message', resolve).once('error', reject);
    });
    const [writer, ...readers] = roles.map(run);
    const corrupted = readers.map(reader => reader.then(error => error ?? new Promise(() => {})));
    return Promise.race([Promise.all([writer, ...readers]).then(() => null), ...corrupted]);
  }

  test('la page et deux pthreads échangent 2 × 100 000 paquets sans perte ni corruption', { timeout: 60_000 }, async t => {
    const roles = [{ role: 'produce' }, { role: 'consume', sock: 0 }, { role: 'consume', sock: 1 }];
    assert.equal(await race(t, new SharedArrayBuffer(RING_BYTES), roles), null);
  });

  test('la page passe 50 000 commandes au moteur par la boîte aux lettres sans en abîmer une', { timeout: 60_000 }, async t => {
    assert.equal(await race(t, new SharedArrayBuffer(MAILBOX_BYTES), [{ role: 'write' }, { role: 'read' }]), null);
  });
}
