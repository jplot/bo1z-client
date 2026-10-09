import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { instructions, leb, parse, rebuild, sleb } from './wasm.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const ARTIFACTS = '/bo1z/artifacts/';

async function override(urlPath, content) {
  const file = path.join(ROOT, 'overrides', urlPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const I32 = 0x7f;
const IMPORTS = [
  { module: 'env', name: 'kb_net_send', params: [I32, I32, I32, I32], results: [] },
  { module: 'env', name: 'kb_net_recv', params: [I32, I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_resolve', params: [I32, I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_command', params: [I32, I32], results: [I32] },
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

// Les octets insérés ne sont pas renumérotés : un appel vers une fonction définie vise déjà son index décalé.
function callDefined(module, name) {
  const index = module.names.get(name);
  if (index === undefined) throw new Error(`fonction absente : ${name}`);
  return [0x10, ...leb(index + IMPORTS.length)];
}

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
  const [send, recv, resolve, command] = IMPORTS.map((_, i) => [0x10, ...leb(module.importedFuncs + i)]);
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

  // Ni un menu (CL_PauseGame) ni le maintien d'intro de la page (cl_paused) ne doivent figer l'hôte : SV_CheckPaused inliné laissait le défi d'un joueur qui rejoint sans réponse.
  const pause = find(module, 'CL_PauseGame(bool)', (_, k) => k === 0, 1);
  add(pause.index, { at: pause.body.code, end: pause.body.code, bytes: [...i32(0), 0x21, ...leb(0)] });

  const clPaused = pause.list.find((ins, k) => ins.op === 0x41 && pause.list[k + 1]?.op === 0x28).value;
  const pausedSkip = (list, k) => list[k].op === 0x41 && list[k].value === clPaused && list[k + 1]?.op === 0x28
    && list[k + 2]?.op === 0x28 && list[k + 2].offset === 24 && list[k + 3]?.op === 0x45 && list[k + 4]?.op === 0x0d && list[k + 4].index === 0;
  const frame = find(module, '__wrap__Z8SV_Frameii', pausedSkip, 1);
  const [f] = frame.found;
  add(frame.index, { at: frame.list[f + 3].at, end: frame.list[f + 3].end, bytes: [0x1a, ...i32(1)] });

  // Échap pendant le chargement qui suit connect (ni connexion ni partie en cours) levait
  // Com_Error(ERR_DISCONNECT, "Bad server address") : la partie du joueur qui rejoint s'arrêtait 0,5 s après connect.
  const comError = module.names.get('Com_Error(errorParm_t, char const*, ...)');
  const escapeError = (list, k) => list[k].op === 0x41 && list[k + 1]?.op === 0x28 && list[k + 2]?.op === 0x45
    && list[k + 3]?.op === 0x0d && list[k + 3].index === 0 && list[k + 4]?.op === 0x41 && list[k + 4].value === 3
    && list[k + 5]?.op === 0x41 && list[k + 6]?.op === 0x41 && list[k + 6].value === 0
    && list[k + 7]?.op === 0x10 && list[k + 7].index === comError && list[k + 8]?.op === 0x0b;
  const keys = find(module, 'CL_KeyEvent(int, int, int, unsigned int)', escapeError, 1);
  const [e] = keys.found;
  add(keys.index, { at: keys.list[e].at, end: keys.list[e + 8].at, bytes: [] });

  // Assertions fatales : un second joueur en déclenche que le solo n'atteint jamais (Vec4IsNormalized dans CG_AddPlayerWeapon).
  const asserts = find(module, 'Assert_MyHandler(char const*, int, int, char const*, ...)', (list, k) => list[k].op === 0x00 && list[k + 1]?.op === 0x0b && k + 2 === list.length, 1);
  const frameSize = asserts.list.find(ins => ins.op === 0x41).value;
  const frameBase = asserts.list.find(ins => ins.op === 0x22).index;
  const [u] = asserts.found;
  add(asserts.index, { at: asserts.list[u].at, end: asserts.list[u].end, bytes: [...get(frameBase), ...i32(frameSize), 0x6a, 0x24, ...leb(0), ...i32(1)] });

  // Effet sans matériau chez le joueur qui rejoint : lecture à l'adresse 176 puis unreachable ; l'appelant saute le dessin sur 0.
  const technique = find(module, 'Material_GetTechnique(Material const*, unsigned char)', (list, k) => list[k].op === 0x00 && k + 2 === list.length, 1);
  const techniqueFrame = technique.list.find(ins => ins.op === 0x41).value;
  const techniqueBase = technique.list.find(ins => ins.op === 0x22).index;
  const [t] = technique.found;
  add(technique.index, { at: technique.body.code, end: technique.body.code, bytes: [...get(0), 0x45, 0x04, 0x40, ...i32(0), 0x0f, 0x0b] });
  add(technique.index, { at: technique.list[t].at, end: technique.list[t].end, bytes: [0x1a, ...get(techniqueBase), ...i32(techniqueFrame), 0x6a, 0x24, ...leb(0), ...i32(0)] });

  // L'hôte n'a pas de DObj pour un joueur distant : à terre, son point d'attache levait ERR_DROP et coupait la partie.
  const noDObj = (list, k) => list[k].op === 0x41 && list[k].value === 1 && list[k + 1]?.op === 0x41
    && list[k + 2]?.op === 0x41 && list[k + 2].value === 0 && list[k + 3]?.op === 0x10 && list[k + 3].index === comError && list[k + 4]?.op === 0x0b;
  const tag = find(module, 'CachedTag_UpdateTagInternal(centity_s const*, cached_client_tag_t*, unsigned int, int, bool)', noDObj, 1);
  const [g] = tag.found;
  add(tag.index, { at: tag.list[g].at, end: tag.list[g + 4].at, bytes: [] });

  // Une commande déposée par la page (kbnet.command) passe à Cbuf_AddText, dans un tampon de 512 octets pris sur la pile.
  const STACK = [0x23, ...leb(0)];
  const events = find(module, 'Com_EventLoop()', (_, k) => k === 0, 1);
  add(events.index, { at: events.body.code, end: events.body.code, bytes: [
    ...STACK, ...i32(512), 0x6b, 0x24, ...leb(0),
    ...STACK, ...i32(512), ...command, 0x04, 0x40, ...i32(0), ...STACK, ...callDefined(module, 'Cbuf_AddText(int, char const*)'), 0x0b,
    ...STACK, ...i32(512), 0x6a, 0x24, ...leb(0),
  ] });
  return edits;
}

const original = await readFile(path.join(ROOT, 'engine', 'KisakBlack-web.wasm'));
const module = parse(new Uint8Array(original));
const wasm = rebuild(module, { imports: IMPORTS, edits: patches(module) });
if (!WebAssembly.validate(wasm)) throw new Error('wasm patché invalide');
await override(`${ARTIFACTS}KisakBlack-web.wasm`, wasm);

// landing.js n'est pas en UTF-8 : l'import s'ajoute aux octets d'origine.
await override('/bo1z/landing.js', Buffer.concat([await readFile(path.join(ROOT, 'web', 'landing.js')), Buffer.from("\nimport './multiplayer.js';\n")]));
await copyFile(path.join(ROOT, 'web', 'multiplayer.js'), path.join(ROOT, 'overrides', 'bo1z', 'multiplayer.js'));

console.log(`wasm patché : ${wasm.length} octets, ${IMPORTS.length} imports`);
