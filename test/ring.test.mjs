import assert from 'node:assert/strict';
import test from 'node:test';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { push, RING_BYTES, SOCKS, take } from '../web/ring.js';

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

if (!isMainThread) {
  const { role, rings, sock } = workerData;
  parentPort.postMessage(role === 'produce' ? produce(rings) ?? null : consume(rings, sock));
} else {
  test('la page et deux pthreads échangent 2 × 100 000 paquets sans perte ni corruption', { timeout: 60_000 }, async t => {
    const rings = new SharedArrayBuffer(RING_BYTES);
    const workers = [];
    t.after(() => workers.forEach(worker => worker.terminate()));
    const run = data => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { rings, ...data } });
      workers.push(worker);
      worker.once('message', resolve).once('error', reject);
    });
    const [producer, ...consumers] = [run({ role: 'produce' }), run({ role: 'consume', sock: 0 }), run({ role: 'consume', sock: 1 })];
    const corrupted = consumers.map(consumer => consumer.then(error => error ?? new Promise(() => {})));
    assert.equal(await Promise.race([Promise.all([producer, ...consumers]).then(() => null), ...corrupted]), null);
  });
}
