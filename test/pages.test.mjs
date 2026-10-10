import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import test from 'node:test';
import { relay } from './relay.mjs';

test('une page de carte est rendue depuis web/map.html, avec ou sans / final', async t => {
  const child = await relay(8616, 0);
  t.after(() => child.kill());
  const moon = await fetch('http://127.0.0.1:8616/moon?room=soiree');
  assert.equal(moon.headers.get('content-type'), 'text/html');
  const html = await moon.text();
  assert.match(html, /<html lang="en" data-map="zombie_moon">/);
  assert.match(html, /<title>Moon<\/title>/);
  assert.match(html, /location\.pathname\.endsWith/);
  assert.match(await (await fetch('http://127.0.0.1:8616/verruckt/')).text(), /<title>Verrückt<\/title>/);
});

test('le menu et le site sont servis depuis web/ à la racine, le moteur patché depuis overrides/', async t => {
  const child = await relay(8617, 0);
  t.after(() => child.kill());
  const menu = await fetch('http://127.0.0.1:8617/?room=soiree');
  assert.match(menu.headers.get('content-type'), /^text\/html\b/);
  assert.match(await menu.text(), /<script type="module" src="menu.js">/);
  const play = await fetch('http://127.0.0.1:8617/play.js');
  assert.match(play.headers.get('content-type'), /^(text|application)\/javascript\b/);
  assert.equal(await play.text(), await readFile(new URL('../web/play.js', import.meta.url), 'utf8'));
});

test('avec PREFIX=/bo1z, le site est servi sous /bo1z/ et la racine y mène', async t => {
  const child = await relay(8621, 0, { PREFIX: '/bo1z' });
  t.after(() => child.kill());
  const at = path => fetch(`http://127.0.0.1:8621${path}`, { redirect: 'manual' });
  for (const [from, to] of [['/?room=soiree', '/bo1z/?room=soiree'], ['/bo1z', '/bo1z/']]) assert.equal((await at(from)).headers.get('location'), to);
  assert.match(await (await at('/bo1z/?room=soiree')).text(), /<script type="module" src="menu.js">/);
  assert.match(await (await at('/bo1z/verruckt')).text(), /<title>Verrückt<\/title>/);
  assert.equal((await (await at('/bo1z/telemetry')).json()).enabled, true);
  assert.equal((await at('/verruckt')).status, 404);
});

test('la télémétrie ne s’ouvre qu’aux pages de ce poste, pas à celles venues du réseau comme sur Heroku', async t => {
  const lan = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (!lan) return t.skip('aucune adresse réseau hors de la boucle locale');
  const child = await relay(8619, 0, { HOST: '0.0.0.0' });
  t.after(() => child.kill());
  assert.equal((await (await fetch('http://127.0.0.1:8619/telemetry')).json()).enabled, true);
  assert.equal((await (await fetch(`http://${lan}:8619/telemetry`)).json()).enabled, false);
  assert.equal((await fetch(`http://${lan}:8619/telemetry`, { method: 'POST', body: '{}' })).status, 403);
});

test('avec TELEMETRY=1, la télémétrie s’ouvre aussi aux pages des autres machines du réseau', async t => {
  const lan = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (!lan) return t.skip('aucune adresse réseau hors de la boucle locale');
  const child = await relay(8620, 0, { HOST: '0.0.0.0', TELEMETRY: '1' });
  t.after(() => child.kill());
  assert.equal((await (await fetch(`http://${lan}:8620/telemetry`)).json()).enabled, true);
});
