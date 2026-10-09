import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { relay } from './relay.mjs';

function join(httpPort, room, origin = `http://127.0.0.1:${httpPort}`, map = 'nacht') {
  const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/signal?room=${room}&map=${map}`, { headers: { origin } });
  const messages = [];
  const waiters = [];
  socket.onmessage = ({ data }) => {
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

test('avec BO1Z_PASSWORD, le site exige le mot de passe', async t => {
  const child = await relay(8613, 0, { BO1Z_PASSWORD: 'zombies' });
  t.after(() => child.kill());
  const url = 'http://127.0.0.1:8613/bo1z/telemetry';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: `Basic ${btoa('ami:mauvais')}` } })).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: `Basic ${btoa('ami:zombies')}` } })).status, 200);
});

test('le lobby est servi à la racine et liste les salons avec leur carte et leur nombre de joueurs', async t => {
  const child = await relay(8614, 0);
  t.after(() => child.kill());
  const page = await fetch('http://127.0.0.1:8614/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const host = join(8614, 'soiree', undefined, 'kino');
  await host.next();
  const guest = join(8614, 'soiree');
  await guest.next();
  assert.deepEqual(await (await fetch('http://127.0.0.1:8614/rooms')).json(), [{ name: 'soiree', map: 'kino', players: 2 }]);
  host.close();
  guest.close();
});
