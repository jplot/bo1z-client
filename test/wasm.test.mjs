import assert from 'node:assert/strict';
import test from 'node:test';
import { leb, parse, rebuild } from '../patch/wasm.mjs';

const I32 = 0x7f;
const section = (id, content) => [id, ...leb(content.length), ...content];
const vec = items => [...leb(items.length), ...items.flat()];
const text = value => [...leb(value.length), ...new TextEncoder().encode(value)];
const body = content => [...leb(content.length), ...content];

const tiny = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, vec([[0x60, 0, 1, I32], [0x60, 1, I32, 0]])),
  ...section(2, vec([[...text('env'), ...text('log'), 0x00, 1]])),
  ...section(3, vec([[0], [0]])),
  ...section(4, vec([[0x70, 0x00, 1]])),
  ...section(7, vec([[...text('callSeven'), 0x00, 2], [...text('table'), 0x01, 0]])),
  ...section(9, vec([[0x00, 0x41, 0x00, 0x0b, ...vec([[1]])]])),
  ...section(10, vec([body([0x00, 0x41, 0x07, 0x0b]), body([0x00, 0x10, 0x01, 0x0b])])),
  ...section(0, [...text('name'), ...section(1, vec([[0, ...text('log')], [1, ...text('seven')], [2, ...text('callSeven')]]))]),
]);

test('reconstruire sans changement redonne le binaire à l’octet près', () => {
  assert.deepEqual(rebuild(parse(tiny)), tiny);
});

test('un import ajouté décale les fonctions définies partout où elles sont référencées', async () => {
  const module = parse(tiny);
  const seen = [];
  const insert = { at: module.bodies[1].code, end: module.bodies[1].code, bytes: [0x41, 42, 0x10, ...leb(module.importedFuncs)] };
  const patched = rebuild(module, {
    imports: [{ module: 'env', name: 'extra', params: [I32], results: [] }],
    edits: new Map([[2, [insert]]]),
  });

  const { instance } = await WebAssembly.instantiate(patched, { env: { log() {}, extra: value => seen.push(value) } });
  assert.equal(instance.exports.callSeven(), 7);
  assert.equal(instance.exports.table.get(0)(), 7);
  assert.deepEqual(seen, [42]);
  assert.deepEqual([...parse(patched).names], [['log', 0], ['extra', 1], ['seven', 2], ['callSeven', 3]]);
});
