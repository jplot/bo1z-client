import assert from 'node:assert/strict';
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
