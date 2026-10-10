import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { relay } from './relay.mjs';

function join(httpPort, room, origin = `http://127.0.0.1:${httpPort}`, map = 'nacht', player = '') {
  const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/signal?room=${room}&map=${map}&player=${player}`, { headers: { origin } });
  const messages = [];
  const waiters = [];
  socket.binaryType = 'arraybuffer';
  socket.frames = [];
  socket.onmessage = ({ data }) => {
    if (typeof data !== 'string') return void socket.frames.push(new Uint8Array(data));
    const message = JSON.parse(data);
    const waiter = waiters.shift();
    if (waiter) waiter(message); else messages.push(message);
  };
  socket.next = () => (messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)));
  return socket;
}

test('le salon numérote les pages, achemine leurs messages et annonce les départs', async t => {
  const child = await relay(8611, 0);
  t.after(() => child.kill());
  const host = join(8611, 'soiree');
  assert.deepEqual((await host.next()).you, '10.0.0.1');
  const guest = join(8611, 'soiree');
  assert.deepEqual((await guest.next()).you, '10.0.0.2');
  assert.deepEqual((await join(8611, 'ailleurs').next()).you, '10.0.0.1');

  guest.send(JSON.stringify({ to: '10.0.0.1', data: { description: 'offre' } }));
  assert.deepEqual(await host.next(), { type: 'signal', from: '10.0.0.2', data: { description: 'offre' } });

  guest.close();
  assert.deepEqual(await host.next(), { type: 'leave', label: '10.0.0.2' });
  host.close();
});

test('une page d’une autre origine ne peut pas entrer dans un salon', async t => {
  const child = await relay(8612, 0);
  t.after(() => child.kill());
  const socket = join(8612, 'soiree', 'https://example.com');
  const [event] = await Promise.race([once(socket, 'error'), once(socket, 'open')]);
  assert.equal(event.type, 'error');
});

test('les anciennes adresses en /bo1z mènent à la même page sans le préfixe, et /rooms liste les salons avec leur carte et les pseudos de leurs joueurs', async t => {
  const child = await relay(8614, 0);
  t.after(() => child.kill());
  for (const [old, now] of [['/bo1z?room=soiree', '/?room=soiree'], ['/bo1z/', '/'], ['/bo1z/nacht?room=soiree', '/nacht?room=soiree']]) {
    const response = await fetch(`http://127.0.0.1:8614${old}`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), now);
  }
  const host = join(8614, 'soiree', undefined, 'kino', 'Hote');
  await host.next();
  const guest = join(8614, 'soiree', undefined, 'nacht', 'Invite');
  await guest.next();
  assert.deepEqual(await (await fetch('http://127.0.0.1:8614/rooms')).json(), [{ name: 'soiree', map: 'kino', players: 2, members: [{ label: '10.0.0.1', pseudo: 'Hote' }, { label: '10.0.0.2', pseudo: 'Invite' }] }]);
  host.close();
  guest.close();
});

test('un salon privé manque à /rooms mais /rooms?code= le trouve, comme un salon public', async t => {
  const child = await relay(8615, 0);
  t.after(() => child.kill());
  const secret = new WebSocket('ws://127.0.0.1:8615/signal?room=MZTR&map=cotd&player=Ines&private=1', { headers: { origin: 'http://127.0.0.1:8615' } });
  await once(secret, 'message');
  const open = join(8615, 'KXQZ', undefined, 'moon', 'Thomas');
  await open.next();
  const rooms = async query => (await fetch(`http://127.0.0.1:8615/rooms${query}`)).json();
  assert.deepEqual((await rooms('')).map(room => room.name), ['KXQZ']);
  assert.deepEqual(await rooms('?code=MZTR'), [{ name: 'MZTR', map: 'cotd', private: true, players: 1, members: [{ label: '10.0.0.1', pseudo: 'Ines' }] }]);
  assert.deepEqual((await rooms('?code=KXQZ')).map(room => room.name), ['KXQZ']);
  assert.deepEqual(await rooms('?code=BRTM'), []);
  secret.close();
  open.close();
});

const packet = (from, seq) => {
  const body = new Uint8Array(3 + (seq * 37) % 1200);
  body[0] = from; body[1] = seq >> 8; body[2] = seq & 0xff;
  for (let i = 3; i < body.length; i++) body[i] = (from * 131 + seq * 7 + i) & 0xff;
  return body;
};
const until = async (check, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 20))) if (check()) return;
  assert.fail('relais : paquets manquants');
};

test('le salon relaie les paquets binaires d’une page à l’autre, intacts, dans l’ordre et sans fuite', async t => {
  const child = await relay(8618, 0);
  t.after(() => child.kill());
  const host = join(8618, 'relais');
  await host.next();
  const guests = [join(8618, 'relais'), join(8618, 'relais')];
  for (const guest of guests) await guest.next();
  const COUNT = 2000;
  const send = (socket, to, from, seq) => socket.send(new Uint8Array([...to.split('.').map(Number), ...packet(from, seq)]));
  for (let seq = 0; seq < COUNT; seq++) {
    guests.forEach((guest, k) => send(guest, '10.0.0.1', 2 + k, seq));
    guests.forEach((_, k) => send(host, `10.0.0.${2 + k}`, 1, seq));
  }
  await until(() => host.frames.length >= 2 * COUNT && guests.every(guest => guest.frames.length >= COUNT));

  const check = (frames, sources) => {
    const next = Object.fromEntries(sources.map(source => [source, 0]));
    for (const frame of frames) {
      const source = [...frame.subarray(0, 4)].join('.');
      assert.ok(source in next, `paquet venu de ${source}`);
      const body = frame.subarray(4);
      assert.deepEqual(body, packet(body[0], next[source]++));
    }
    for (const source of sources) assert.equal(next[source], COUNT);
  };
  check(host.frames, ['10.0.0.2', '10.0.0.3']);
  guests.forEach(guest => check(guest.frames, ['10.0.0.1']));
  for (const socket of [host, ...guests]) socket.close();
});
