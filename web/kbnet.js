import { push, RING_BYTES, SLOT_DATA, SOCKS, take } from './ring.js';

// Chargé par la page et par chaque pthread : les pthreads n'ont pas de boucle d'événements fiable pendant la partie,
// donc la page tient le WebSocket et dépose les paquets reçus dans une mémoire partagée qu'ils lisent à chaque frame.
const NA_IP = 4;
const DEFAULT_PORT = 3074;
const MAILBOX_BYTES = 1024;

let memory = null;
let socket = null;
let stats = null;
let rings = null;
let mailbox = null;
export let shared = null;
const pendingCommands = [];

function cString(heap, pointer) {
  return new TextDecoder().decode(heap.slice(pointer, heap.indexOf(0, pointer)));
}

export function attach(wasmMemory, page) {
  memory = wasmMemory;
  ({ rings, mailbox } = page);
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
  return Number(take(rings, sock, (address, data) => {
    const view = new DataView(memory.buffer);
    const heap = new Uint8Array(memory.buffer);
    heap.fill(0, from, from + 16);
    view.setInt32(from, NA_IP, true);
    heap.set(address, from + 4);
    heap.set(data, view.getInt32(msg + 8, true));
    view.setInt32(msg + 20, data.length, true);
  }));
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

// Boîte aux lettres à un seul message : longueur en tête, publiée après le texte, remise à 0 par le moteur une fois lu.
export function nextCommand(buffer, size) {
  const length = new Int32Array(mailbox, 0, 1);
  const count = Math.min(Atomics.load(length, 0), size - 1);
  if (!count) return 0;
  const heap = new Uint8Array(memory.buffer);
  heap.set(new Uint8Array(mailbox, 4, count), buffer);
  heap[buffer + count] = 0;
  Atomics.store(length, 0, 0);
  return 1;
}

function postCommands() {
  const length = new Int32Array(mailbox, 0, 1);
  if (!pendingCommands.length || Atomics.load(length, 0)) return;
  const bytes = new TextEncoder().encode(`${pendingCommands.shift()}\n`);
  new Uint8Array(mailbox, 4, bytes.length).set(bytes);
  Atomics.store(length, 0, bytes.length);
}

export function command(text) {
  pendingCommands.push(text);
}

export function forward(packet) {
  if (socket.readyState !== WebSocket.OPEN) return stats.dropped++;
  socket.send(packet);
  stats.sent++;
}

// Le serveur reçoit sur NS_SERVER ce qu'un client émet depuis NS_CLIENT1, et inversement.
function deliver(datagram) {
  const sock = datagram[6] ^ 1;
  const queued = sock < SOCKS && datagram.length - 7 <= SLOT_DATA && push(rings, sock, datagram.subarray(0, 6), datagram.subarray(7));
  stats[queued ? 'received' : 'dropped']++;
}

if (!globalThis.WorkerGlobalScope) {
  stats = globalThis.kbnet = { sent: 0, received: 0, dropped: 0, command };
  rings = new SharedArrayBuffer(RING_BYTES);
  mailbox = new SharedArrayBuffer(4 + MAILBOX_BYTES);
  shared = { rings, mailbox };
  setInterval(postCommands, 50);
  const url = new URL('/kbnet', location.href);
  url.protocol = 'ws:';
  socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onmessage = ({ data }) => deliver(new Uint8Array(data));

  // Rejoindre depuis une partie locale chargée : la connexion directe au démarrage lit l'état initial de travers.
  const host = new URLSearchParams(location.search).get('connect');
  if (host) {
    const waiting = setInterval(() => {
      if (globalThis.five?.screen !== 'playing') return;
      clearInterval(waiting);
      command(`connect ${host}`);
    }, 500);
  }
}
