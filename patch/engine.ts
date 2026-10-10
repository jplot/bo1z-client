import { type Edit, type Import, type Instruction, instructions, leb, type Module, parse, rebuild, sleb } from './wasm.ts';

const I32 = 0x7f;
const IMPORTS: Import[] = [
  { module: 'env', name: 'kb_net_send', params: [I32, I32, I32, I32], results: [] },
  { module: 'env', name: 'kb_net_recv', params: [I32, I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_resolve', params: [I32, I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_command', params: [I32, I32], results: [I32] },
  { module: 'env', name: 'kb_net_multiplayer', params: [], results: [I32] },
];
const get = (local: number) => [0x20, ...leb(local)];
const i32 = (value: number) => [0x41, ...sleb(value)];
const PACKET_BUFFER = 135824384;

// One site per inlined NET_SendPacket, in body order. Values read from its loopback branch:
// sock = chan->sock or the netsrc_t argument, len = datalen written at slot+1264, data = the memory.copy source.
type Site = { sock: number; len: number; data: number | [number]; adr: [number, number] };
const SENDS: Record<string, Site[]> = {
  'NET_OutOfBandPrint(netsrc_t, netadr_t, char const*)': [{ sock: 0, len: 4, data: PACKET_BUFFER, adr: [1, 0] }],
  'NET_OutOfBandData(netsrc_t, netadr_t, unsigned char const*, int)': [{ sock: 0, len: 2, data: PACKET_BUFFER, adr: [1, 0] }],
  'Netchan_TransmitNextFragment(netchan_t*)': [{ sock: 0, len: 5, data: [8], adr: [2, 1408] }],
  'Netchan_Transmit(netchan_t*, int, char*, bool)': [{ sock: 1, len: 5, data: [7], adr: [4, 1456] }],
  'Netchan_Process(netchan_t*, msg_t*)': [
    { sock: 1, len: 5, data: [4], adr: [3, 2288] },
    { sock: 2, len: 9, data: [12], adr: [3, 2288] },
  ],
};

const isSimd = (ins: Instruction | undefined, sub: number) => ins?.op === 0xfd && ins.sub === sub;

// Inserted bytes are not renumbered: a call to a defined function must already target its shifted index.
function callDefined(module: Module, name: string) {
  const index = module.names.get(name);
  if (index === undefined) throw new Error(`missing function: ${name}`);
  return [0x10, ...leb(index + IMPORTS.length)];
}

function find(module: Module, name: string, matches: (list: Instruction[], k: number) => boolean, expected: number) {
  const index = module.names.get(name);
  if (index === undefined) throw new Error(`missing function: ${name}`);
  const body = module.bodies[index - module.importedFuncs];
  const list = [...instructions(module.bytes, body.code, body.end)];
  const found = list.flatMap((_, k) => (matches(list, k) ? [k] : []));
  if (found.length !== expected) throw new Error(`${name}: ${found.length} site(s) instead of ${expected}`);
  return { index, body, list, found };
}

function patches(module: Module) {
  const [send, recv, resolve, command, multiplayer] = IMPORTS.map((_, i) => [0x10, ...leb(module.importedFuncs + i)]);
  const edits = new Map<number, Edit[]>();
  const add = (index: number, edit: Edit) => edits.set(index, [...(edits.get(index) ?? []), edit]);

  for (const [name, sites] of Object.entries(SENDS)) {
    const copiesAddress = (list: Instruction[], k: number) => list[k].op === 0x20 && list[k + 1].op === 0x20
      && isSimd(list[k + 2], 0) && isSimd(list[k + 3], 11) && list[k + 4]?.op === 0x0b;
    const { index, list, found } = find(module, name, copiesAddress, sites.length);
    found.forEach((k, i) => {
      const { sock, len, data, adr: [local, offset] } = sites[i];
      if (list[k + 1].index !== local || list[k + 2].offset !== offset) throw new Error(`${name} site ${i}: unexpected address`);
      const address = offset ? [...get(local), ...i32(offset), 0x6a] : get(local);
      const bytes = [...get(sock), ...get(len), ...(Array.isArray(data) ? get(data[0]) : i32(data)), ...address, ...send];
      add(index, { at: list[k + 4].at, end: list[k + 4].at, bytes });
    });
  }

  const loop = find(module, 'NET_GetLoopPacket(netsrc_t, netadr_t*, msg_t*)', (_, k) => k === 0, 1);
  add(loop.index, { at: loop.body.code, end: loop.body.code, bytes: [...get(0), ...get(1), ...get(2), ...recv, 0x04, 0x40, ...i32(1), 0x0f, 0x0b] });

  // Original failure (type NA_BAD, return 0): $2 = host NUL-terminated in place of the ':', $0 = port or 0, $1 = netadr_t.
  const failed = (list: Instruction[], k: number) => list[k].op === 0x20 && list[k].index === 1 && list[k + 1].op === 0x41 && list[k + 1].value === 1
    && list[k + 2].op === 0x36 && list[k + 3].op === 0x41 && list[k + 3].value === 0 && list[k + 4]?.op === 0x0b;
  const adr = find(module, 'NET_StringToAdr(char const*, netadr_t*)', failed, 1);
  const [k] = adr.found;
  add(adr.index, { at: adr.list[k].at, end: adr.list[k + 4].at, bytes: [...get(2), ...get(0), ...get(1), ...resolve] });

  // Inlined Sys_IsLANAddress reduced to type == NA_LOOPBACK: an NA_IP address silently dropped the connection.
  const lan = (list: Instruction[], k: number) => list[k].op === 0x20 && list[k].index === 0 && list[k + 1].op === 0x28 && list[k + 1].offset === 16
    && list[k + 2].op === 0x41 && list[k + 2].value === 2 && list[k + 3].op === 0x46 && list[k + 4]?.op === 0x04;
  const connect = find(module, 'CL_Connect_f()', lan, 1);
  const [c] = connect.found;
  const loadType = module.bytes.subarray(connect.list[c].at, connect.list[c + 1].end);
  // (20 >> type) & 1: bits 2 (NA_LOOPBACK) and 4 (NA_IP).
  add(connect.index, { at: connect.list[c].at, end: connect.list[c + 4].at, bytes: [...i32(20), ...loadType, 0x76, ...i32(1), 0x71] });

  // In multiplayer, neither a menu (CL_PauseGame) nor the page's intro hold (cl_paused) may freeze the host: inlined
  // SV_CheckPaused left a joining player's challenge unanswered. In solo, the game's pause stays.
  const pause = find(module, 'CL_PauseGame(bool)', (_, k) => k === 0, 1);
  add(pause.index, { at: pause.body.code, end: pause.body.code, bytes: [...multiplayer, 0x04, 0x40, ...i32(0), 0x21, ...leb(0), 0x0b] });

  const clPaused = pause.list.find((ins, k) => ins.op === 0x41 && pause.list[k + 1]?.op === 0x28)!.value;
  const pausedSkip = (list: Instruction[], k: number) => list[k].op === 0x41 && list[k].value === clPaused && list[k + 1]?.op === 0x28
    && list[k + 2]?.op === 0x28 && list[k + 2].offset === 24 && list[k + 3]?.op === 0x45 && list[k + 4]?.op === 0x0d && list[k + 4].index === 0;
  const frame = find(module, '__wrap__Z8SV_Frameii', pausedSkip, 1);
  const [f] = frame.found;
  add(frame.index, { at: frame.list[f + 3].end, end: frame.list[f + 3].end, bytes: [...multiplayer, 0x72] });

  // Escape during the load that follows connect (no connection nor game yet) raised
  // Com_Error(ERR_DISCONNECT, "Bad server address"): the joining player's game stopped 0.5 s after connect.
  const comError = module.names.get('Com_Error(errorParm_t, char const*, ...)');
  const escapeError = (list: Instruction[], k: number) => list[k].op === 0x41 && list[k + 1]?.op === 0x28 && list[k + 2]?.op === 0x45
    && list[k + 3]?.op === 0x0d && list[k + 3].index === 0 && list[k + 4]?.op === 0x41 && list[k + 4].value === 3
    && list[k + 5]?.op === 0x41 && list[k + 6]?.op === 0x41 && list[k + 6].value === 0
    && list[k + 7]?.op === 0x10 && list[k + 7].index === comError && list[k + 8]?.op === 0x0b;
  const keys = find(module, 'CL_KeyEvent(int, int, int, unsigned int)', escapeError, 1);
  const [e] = keys.found;
  add(keys.index, { at: keys.list[e].at, end: keys.list[e + 8].at, bytes: [] });

  // Fatal assertions: a second player triggers some that solo never reaches (Vec4IsNormalized in CG_AddPlayerWeapon).
  const asserts = find(module, 'Assert_MyHandler(char const*, int, int, char const*, ...)', (list, k) => list[k].op === 0x00 && list[k + 1]?.op === 0x0b && k + 2 === list.length, 1);
  const frameSize = asserts.list.find(ins => ins.op === 0x41)!.value!;
  const frameBase = asserts.list.find(ins => ins.op === 0x22)!.index!;
  const [u] = asserts.found;
  add(asserts.index, { at: asserts.list[u].at, end: asserts.list[u].end, bytes: [...get(frameBase), ...i32(frameSize), 0x6a, 0x24, ...leb(0), ...i32(1)] });

  // An effect without a material on the joining player: a read at address 176, then unreachable; the caller skips the draw on 0.
  const technique = find(module, 'Material_GetTechnique(Material const*, unsigned char)', (list, k) => list[k].op === 0x00 && k + 2 === list.length, 1);
  const techniqueFrame = technique.list.find(ins => ins.op === 0x41)!.value!;
  const techniqueBase = technique.list.find(ins => ins.op === 0x22)!.index!;
  const [t] = technique.found;
  add(technique.index, { at: technique.body.code, end: technique.body.code, bytes: [...get(0), 0x45, 0x04, 0x40, ...i32(0), 0x0f, 0x0b] });
  add(technique.index, { at: technique.list[t].at, end: technique.list[t].end, bytes: [0x1a, ...get(techniqueBase), ...i32(techniqueFrame), 0x6a, 0x24, ...leb(0), ...i32(0)] });

  // The host has no DObj for a remote player: when downed, its attachment tag raised ERR_DROP and ended the game.
  const noDObj = (list: Instruction[], k: number) => list[k].op === 0x41 && list[k].value === 1 && list[k + 1]?.op === 0x41
    && list[k + 2]?.op === 0x41 && list[k + 2].value === 0 && list[k + 3]?.op === 0x10 && list[k + 3].index === comError && list[k + 4]?.op === 0x0b;
  const tag = find(module, 'CachedTag_UpdateTagInternal(centity_s const*, cached_client_tag_t*, unsigned int, int, bool)', noDObj, 1);
  const [g] = tag.found;
  add(tag.index, { at: tag.list[g].at, end: tag.list[g + 4].at, bytes: [] });

  // A command posted by the page (kbnet.command) goes to Cbuf_AddText, through a 512-byte buffer taken on the stack.
  const STACK = [0x23, ...leb(0)];
  const events = find(module, 'Com_EventLoop()', (_, k) => k === 0, 1);
  add(events.index, { at: events.body.code, end: events.body.code, bytes: [
    ...STACK, ...i32(512), 0x6b, 0x24, ...leb(0),
    ...STACK, ...i32(512), ...command, 0x04, 0x40, ...i32(0), ...STACK, ...callDefined(module, 'Cbuf_AddText(int, char const*)'), 0x0b,
    ...STACK, ...i32(512), 0x6a, 0x24, ...leb(0),
  ] });
  return edits;
}

export function patchEngine(original: Uint8Array) {
  const module = parse(new Uint8Array(original));
  const wasm = rebuild(module, { imports: IMPORTS, edits: patches(module) });
  if (!WebAssembly.validate(wasm)) throw new Error('The patched wasm is invalid');
  return wasm;
}
