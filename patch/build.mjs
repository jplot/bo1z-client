import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib';
import { entryPath } from '../lib/cache.mjs';
import { instructions, leb, parse, rebuild, sleb } from './wasm.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const ARTIFACTS = '/bo1z/artifacts/';
const DECODERS = { br: brotliDecompressSync, gzip: gunzipSync, zstd: zstdDecompressSync };

async function cached(urlPath) {
  const file = entryPath(new URL(urlPath, 'http://127.0.0.1'));
  const encoding = JSON.parse(await readFile(`${file}.json`, 'utf8')).headers['content-encoding'];
  const raw = await readFile(file);
  return encoding ? DECODERS[encoding](raw) : raw;
}

async function override(urlPath, content) {
  const file = path.join(ROOT, 'overrides', urlPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label} : « ${from} » trouvé ${count} fois`);
  return text.replace(from, () => to);
}

const I32 = 0x7f;
const IMPORTS = [
  { module: 'env', name: 'kb_net_send', params: [I32, I32, I32, I32], results: [] },
  { module: 'env', name: 'kb_net_recv', params: [I32, I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_resolve', params: [I32, I32, I32], results: [I32] },
];
const get = local => [0x20, ...leb(local)];
const i32 = value => [0x41, ...sleb(value)];
const PACKET_BUFFER = 135824384;

// Un site par NET_SendPacket inliné, dans l'ordre du corps. Valeurs relevées dans sa branche boucle locale :
// sock = chan->sock ou le netsrc_t reçu, len = datalen écrit en slot+1264, data = source du memory.copy.
const SENDS = {
  'NET_OutOfBandPrint(netsrc_t, netadr_t, char const*)': [{ sock: 0, len: 4, data: PACKET_BUFFER, adr: [1, 0] }],
  'NET_OutOfBandData(netsrc_t, netadr_t, unsigned char const*, int)': [{ sock: 0, len: 2, data: PACKET_BUFFER, adr: [1, 0] }],
  'Netchan_TransmitNextFragment(netchan_t*)': [{ sock: 0, len: 5, data: [8], adr: [2, 1408] }],
  'Netchan_Transmit(netchan_t*, int, char*, bool)': [{ sock: 1, len: 5, data: [7], adr: [4, 1456] }],
  'Netchan_Process(netchan_t*, msg_t*)': [
    { sock: 1, len: 5, data: [4], adr: [3, 2288] },
    { sock: 2, len: 9, data: [12], adr: [3, 2288] },
  ],
};

const isSimd = (ins, sub) => ins?.op === 0xfd && ins.sub === sub;

function find(module, name, matches, expected) {
  const index = module.names.get(name);
  if (index === undefined) throw new Error(`fonction absente : ${name}`);
  const body = module.bodies[index - module.importedFuncs];
  const list = [...instructions(module.bytes, body.code, body.end)];
  const found = list.flatMap((_, k) => (matches(list, k) ? [k] : []));
  if (found.length !== expected) throw new Error(`${name} : ${found.length} site(s) au lieu de ${expected}`);
  return { index, body, list, found };
}

function patches(module) {
  const [send, recv, resolve] = IMPORTS.map((_, i) => [0x10, ...leb(module.importedFuncs + i)]);
  const edits = new Map();
  const add = (index, edit) => edits.set(index, [...(edits.get(index) ?? []), edit]);

  for (const [name, sites] of Object.entries(SENDS)) {
    const copiesAddress = (list, k) => list[k].op === 0x20 && list[k + 1].op === 0x20
      && isSimd(list[k + 2], 0) && isSimd(list[k + 3], 11) && list[k + 4]?.op === 0x0b;
    const { index, list, found } = find(module, name, copiesAddress, sites.length);
    found.forEach((k, i) => {
      const { sock, len, data, adr: [local, offset] } = sites[i];
      if (list[k + 1].index !== local || list[k + 2].offset !== offset) throw new Error(`${name} site ${i} : adresse inattendue`);
      const address = offset ? [...get(local), ...i32(offset), 0x6a] : get(local);
      const bytes = [...get(sock), ...get(len), ...(Array.isArray(data) ? get(data[0]) : i32(data)), ...address, ...send];
      add(index, { at: list[k + 4].at, end: list[k + 4].at, bytes });
    });
  }

  const loop = find(module, 'NET_GetLoopPacket(netsrc_t, netadr_t*, msg_t*)', (_, k) => k === 0, 1);
  add(loop.index, { at: loop.body.code, end: loop.body.code, bytes: [...get(0), ...get(1), ...get(2), ...recv, 0x04, 0x40, ...i32(1), 0x0f, 0x0b] });

  // Échec d'origine (type NA_BAD, retour 0) : $2 = hôte terminé par NUL à la place du ':', $0 = port ou 0, $1 = netadr_t.
  const failed = (list, k) => list[k].op === 0x20 && list[k].index === 1 && list[k + 1].op === 0x41 && list[k + 1].value === 1
    && list[k + 2].op === 0x36 && list[k + 3].op === 0x41 && list[k + 3].value === 0 && list[k + 4]?.op === 0x0b;
  const adr = find(module, 'NET_StringToAdr(char const*, netadr_t*)', failed, 1);
  const [k] = adr.found;
  add(adr.index, { at: adr.list[k].at, end: adr.list[k + 4].at, bytes: [...get(2), ...get(0), ...get(1), ...resolve] });

  // Sys_IsLANAddress inliné réduit à type == NA_LOOPBACK : un NA_IP abandonnait la connexion en silence.
  const lan = (list, k) => list[k].op === 0x20 && list[k].index === 0 && list[k + 1].op === 0x28 && list[k + 1].offset === 16
    && list[k + 2].op === 0x41 && list[k + 2].value === 2 && list[k + 3].op === 0x46 && list[k + 4]?.op === 0x04;
  const connect = find(module, 'CL_Connect_f()', lan, 1);
  const [c] = connect.found;
  const loadType = module.bytes.subarray(connect.list[c].at, connect.list[c + 1].end);
  // (20 >> type) & 1 : bits 2 (NA_LOOPBACK) et 4 (NA_IP).
  add(connect.index, { at: connect.list[c].at, end: connect.list[c + 4].at, bytes: [...i32(20), ...loadType, 0x76, ...i32(1), 0x71] });

  // Le serveur se fige quand le client local est en pause et qu'il compte au plus un client connecté (SV_CheckPaused) :
  // pendant qu'un joueur rejoint, l'hôte qui quitte sa fenêtre laissait le défi sans réponse.
  const pause = find(module, 'CL_PauseGame(bool)', (_, k) => k === 0, 1);
  add(pause.index, { at: pause.body.code, end: pause.body.code, bytes: [...i32(0), 0x21, ...leb(0)] });
  return edits;
}

const original = await cached(`${ARTIFACTS}KisakBlack-web.wasm`);
const module = parse(new Uint8Array(original));
const wasm = rebuild(module, { imports: IMPORTS, edits: patches(module) });
if (!WebAssembly.validate(wasm)) throw new Error('wasm patché invalide');
await override(`${ARTIFACTS}KisakBlack-web.wasm`, wasm);

let glue = (await cached(`${ARTIFACTS}KisakBlack-web.mjs`)).toString();
glue = replaceOnce(glue, 'wgpuDeviceHasFeature:_wgpuDeviceHasFeature}',
  'wgpuDeviceHasFeature:_wgpuDeviceHasFeature,kb_net_send:kbnet.send,kb_net_recv:kbnet.recv,kb_net_resolve:kbnet.resolve}', 'imports');
glue = replaceOnce(glue, 'worker.postMessage({cmd:1,handlers,wasmMemory,wasmModule})',
  'worker.postMessage({cmd:1,handlers,wasmMemory,wasmModule,kbnet:kbnet.rings})', 'chargement des pthreads');
glue = replaceOnce(glue, 'wasmMemory=msgData.wasmMemory;', 'wasmMemory=msgData.wasmMemory;kbnet.attach(wasmMemory,msgData.kbnet);', 'pthread');
glue = replaceOnce(glue, 'worker.onmessage=e=>{var d=e.data;', 'worker.onmessage=e=>{var d=e.data;if(d.kbnet)return kbnet.forward(d.kbnet);', 'messages des pthreads');
await override(`${ARTIFACTS}KisakBlack-web.mjs`, `import * as kbnet from "./kbnet.js";${glue}`);
for (const file of ['kbnet.js', 'ring.js']) await copyFile(path.join(ROOT, 'web', file), path.join(ROOT, 'overrides', ARTIFACTS, file));

const engine = replaceOnce((await cached('/bo1z/engine.js')).toString(), '    state.arguments = args;',
  "    args.splice(args.indexOf('+devmap'), 0, '+set', 'monkeytoy', '0');\n    const kbnetConnect = new URLSearchParams(location.search).get('connect');\n    if (kbnetConnect) args.splice(args.indexOf('+devmap'), 2, '+connect', kbnetConnect);\n    state.arguments = args;", 'arguments du moteur');
await override('/bo1z/engine.js', engine);

// La console attend le caractère 8 pour effacer, comme WM_CHAR sous Windows ; Cmd+V intercepté bloquait l'événement paste.
let input = (await cached('/bo1z/input.js')).toString();
input = replaceOnce(input, "    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) emit({ kind: 'char', char: event.key.codePointAt(0) });\n",
  "    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) emit({ kind: 'char', char: event.key.codePointAt(0) });\n    else if (event.key === 'Backspace') emit({ kind: 'char', char: 8 });\n", 'effacement');
input = replaceOnce(input, '    if (key === undefined) return;\n    event.preventDefault();\n',
  "    if (key === undefined) return;\n    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyV') return;\n    event.preventDefault();\n", 'raccourci coller');
input = replaceOnce(input, "  on(document, 'keyup', event => {\n",
  "  on(document, 'paste', event => {\n    if (!active()) return;\n    event.preventDefault();\n    for (const char of event.clipboardData.getData('text')) if (char >= ' ') emit({ kind: 'char', char: char.codePointAt(0) });\n  });\n  on(document, 'keyup', event => {\n", 'coller');
await override('/bo1z/input.js', input);

console.log(`wasm patché : ${wasm.length} octets, ${IMPORTS.length} imports`);
