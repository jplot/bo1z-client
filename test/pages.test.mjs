import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import test from 'node:test';
import { relay } from './relay.mjs';

test('une page de carte est rendue depuis web/map.html, avec ou sans / final', async t => {
  const child = await relay(8616, 0);
  t.after(() => child.kill());
  const moon = await fetch('http://127.0.0.1:8616/bo1z/moon?room=soiree');
  assert.equal(moon.headers.get('content-type'), 'text/html');
  const html = await moon.text();
  assert.match(html, /<html lang="en" data-map="zombie_moon">/);
  assert.match(html, /<title>Moon<\/title>/);
  assert.match(html, /location\.pathname\.endsWith/);
  assert.match(await (await fetch('http://127.0.0.1:8616/bo1z/verruckt/')).text(), /<title>Verrückt<\/title>/);
});

test('le menu et le site sont servis depuis web/ sous /bo1z, le moteur patché depuis overrides/', async t => {
  const child = await relay(8617, 0);
  t.after(() => child.kill());
  const menu = await fetch('http://127.0.0.1:8617/bo1z?room=soiree');
  assert.match(menu.headers.get('content-type'), /^text\/html\b/);
  assert.match(await menu.text(), /<script type="module" src="menu.js">/);
  const play = await fetch('http://127.0.0.1:8617/bo1z/play.js');
  assert.match(play.headers.get('content-type'), /^(text|application)\/javascript\b/);
  assert.equal(await play.text(), await readFile(new URL('../web/play.js', import.meta.url), 'utf8'));
});

test('la télémétrie ne s’ouvre qu’aux pages de ce poste, pas à celles venues du réseau comme sur Heroku', async t => {
  const lan = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
  if (!lan) return t.skip('aucune adresse réseau hors de la boucle locale');
  const child = await relay(8619, 0, { HOST: '0.0.0.0' });
  t.after(() => child.kill());
  assert.equal((await (await fetch('http://127.0.0.1:8619/bo1z/telemetry')).json()).enabled, true);
  assert.equal((await (await fetch(`http://${lan}:8619/bo1z/telemetry`)).json()).enabled, false);
  assert.equal((await fetch(`http://${lan}:8619/bo1z/telemetry`, { method: 'POST', body: '{}' })).status, 403);
});
