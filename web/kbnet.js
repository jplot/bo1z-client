// Chargé par la page et par chaque pthread : les pthreads n'ont pas de boucle d'événements fiable pendant la partie,
// donc la page tient le WebSocket et dépose les paquets reçus dans une mémoire partagée qu'ils lisent à chaque frame.
const SOCKS = 2;
const SLOTS = 64;
const SLOT_DATA = 4096;
const SLOT_BYTES = 16 + SLOT_DATA;
const HEADER_BYTES = 16;
const NA_IP = 4;
const DEFAULT_PORT = 3074;

let memory = null;
let socket = null;
let stats = null;
export let rings = null;

const slotOffset = (sock, counter) => HEADER_BYTES + (sock * SLOTS + (counter % SLOTS)) * SLOT_BYTES;

function cString(heap, pointer) {
  return new TextDecoder().decode(heap.slice(pointer, heap.indexOf(0, pointer)));
}

export function attach(wasmMemory, shared) {
  memory = wasmMemory;
  rings = shared;
}

// Datagramme : 4 octets d'IPv4 et 2 de port big-endian (lus tels quels dans netadr_t), sock émetteur, données.
export function send(sock, length, data, adr) {
  const heap = new Uint8Array(memory.buffer);
  const packet = new Uint8Array(7 + length);
  packet.set(heap.subarray(adr + 4, adr + 10));
  packet[6] = sock;
  packet.set(heap.subarray(data, data + length), 7);
  postMessage({ kbnet: packet }, [packet.buffer]);
}

export function recv(sock, from, msg) {
  if (sock >= SOCKS) return 0;
  const header = new Int32Array(rings, 0, SOCKS * 2);
  const tail = header[sock * 2 + 1];
  if (Atomics.load(header, sock * 2) === tail) return 0;
  const offset = slotOffset(sock, tail);
  const length = new DataView(rings).getUint32(offset, true);
  const view = new DataView(memory.buffer);
  const heap = new Uint8Array(memory.buffer);
  heap.fill(0, from, from + 16);
  view.setInt32(from, NA_IP, true);
  heap.set(new Uint8Array(rings, offset + 4, 6), from + 4);
  heap.set(new Uint8Array(rings, offset + 16, length), view.getInt32(msg + 8, true));
  view.setInt32(msg + 20, length, true);
  Atomics.store(header, sock * 2 + 1, tail + 1);
  return 1;
}

export function resolve(host, port, adr) {
  const heap = new Uint8Array(memory.buffer);
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(cString(heap, host))?.slice(1).map(Number);
  if (!ip || ip.some(part => part > 255)) return 0;
  const view = new DataView(memory.buffer);
  view.setInt32(adr, NA_IP, true);
  heap.set(ip, adr + 4);
  view.setUint16(adr + 8, port ? Number(cString(heap, port)) : DEFAULT_PORT);
  return 1;
}

export function forward(packet) {
  if (socket.readyState !== WebSocket.OPEN) return stats.dropped++;
  socket.send(packet);
  stats.sent++;
}

// Le serveur reçoit sur NS_SERVER ce qu'un client émet depuis NS_CLIENT1, et inversement.
function deliver(datagram) {
  const sock = datagram[6] ^ 1;
  const length = datagram.length - 7;
  if (sock >= SOCKS || length > SLOT_DATA) return stats.dropped++;
  const header = new Int32Array(rings, 0, SOCKS * 2);
  const head = header[sock * 2];
  if (head - Atomics.load(header, sock * 2 + 1) >= SLOTS) return stats.dropped++;
  const offset = slotOffset(sock, head);
  new DataView(rings).setUint32(offset, length, true);
  new Uint8Array(rings, offset + 4, 6).set(datagram.subarray(0, 6));
  new Uint8Array(rings, offset + 16, length).set(datagram.subarray(7));
  Atomics.store(header, sock * 2, head + 1);
  stats.received++;
}

if (!globalThis.WorkerGlobalScope) {
  stats = globalThis.kbnet = { sent: 0, received: 0, dropped: 0 };
  rings = new SharedArrayBuffer(HEADER_BYTES + SOCKS * SLOTS * SLOT_BYTES);
  const url = new URL('/kbnet', location.href);
  url.protocol = 'ws:';
  socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onmessage = ({ data }) => deliver(new Uint8Array(data));
}
