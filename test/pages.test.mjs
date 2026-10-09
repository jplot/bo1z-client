import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.equal(menu.headers.get('content-type'), 'text/html');
  assert.match(await menu.text(), /<script type="module" src="menu.js">/);
  const play = await fetch('http://127.0.0.1:8617/bo1z/play.js');
  assert.equal(play.headers.get('content-type'), 'text/javascript');
  assert.equal(await play.text(), await readFile(new URL('../web/play.js', import.meta.url), 'utf8'));
});
