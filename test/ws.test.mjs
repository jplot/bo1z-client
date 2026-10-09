import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { accept } from '../lib/ws.mjs';

const PING = 0x89;

test('une WebSocket muette reçoit un ping avant les 55 s du routeur Heroku, et plus rien une fois fermée', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const written = [];
  const socket = Object.assign(new EventEmitter(), { write: data => written.push(Buffer.from(data)), destroy: () => {} });
  accept({ headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } }, socket, () => {}, 'test');
  written.length = 0;
  t.mock.timers.tick(54_000);
  assert.ok(written.some(data => data[0] === PING));
  socket.emit('close');
  written.length = 0;
  t.mock.timers.tick(120_000);
  assert.equal(written.length, 0);
});
