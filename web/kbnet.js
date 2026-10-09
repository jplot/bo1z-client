import { MAILBOX_BYTES, post, push, receive, RING_BYTES, SLOT_DATA, SOCKS, take } from './ring.js';

// Chargé par la page et par chaque pthread : les pthreads n'ont pas de boucle d'événements fiable pendant la partie,
// donc la page tient le WebSocket et dépose les paquets reçus dans une mémoire partagée qu'ils lisent à chaque frame.
const NA_IP = 4;
const DEFAULT_PORT = 3074;

let memory = null;
let transport = null;
let stats = null;
let rings = null;
let mailbox = null;
let multi = null;
export let shared = null;
const pendingCommands = [];

function cString(heap, pointer) {
  return new TextDecoder().decode(heap.slice(pointer, heap.indexOf(0, pointer)));
}

export function attach(wasmMemory, page) {
  memory = wasmMemory;
  ({ rings, mailbox, multi } = page);
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

export function nextCommand(buffer, size) {
  return Number(receive(mailbox, text => {
    const heap = new Uint8Array(memory.buffer);
    const count = Math.min(text.length, size - 1);
    heap.set(text.subarray(0, count), buffer);
    heap[buffer + count] = 0;
  }));
}

function postCommands() {
  if (pendingCommands.length && post(mailbox, new TextEncoder().encode(`${pendingCommands[0]}\n`))) pendingCommands.shift();
}

export function multiplayer() {
  return Atomics.load(new Int32Array(multi), 0);
}

// Hôte d'un salon, invité, ou partie locale qu'un autre joueur vient de rejoindre par le relais UDP.
function markMultiplayer() {
  Atomics.store(new Int32Array(multi), 0, 1);
}

export function command(text) {
  pendingCommands.push(text);
}

export function forward(packet) {
  if (!transport(packet)) return stats.dropped++;
  stats.sent++;
}

// Le serveur reçoit sur NS_SERVER ce qu'un client émet depuis NS_CLIENT1, et inversement.
function deliver(datagram) {
  markMultiplayer();
  const sock = datagram[6] ^ 1;
  const queued = sock < SOCKS && datagram.length - 7 <= SLOT_DATA && push(rings, sock, datagram.subarray(0, 6), datagram.subarray(7));
  stats[queued ? 'received' : 'dropped']++;
}

const socketUrl = (pathname, query = {}) => {
  const url = new URL(pathname, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
};

// Rejoindre depuis une partie locale chargée : la connexion directe au démarrage lit l'état initial de travers.
function whenPlaying(ready, ...texts) {
  const waiting = setInterval(() => {
    if (globalThis.five?.screen !== 'playing' || !ready()) return;
    clearInterval(waiting);
    texts.forEach(command);
  }, 500);
}

// Le serveur renomme les doublons « Unknown Soldier 1 » ; name part avant connect pour que la demande de connexion le porte.
function pseudo() {
  try {
    return (localStorage.getItem('bo1z-name') ?? '').replace(/[^\w-]/g, '').slice(0, 15);
  } catch {
    return '';
  }
}
const named = (...texts) => [...(pseudo() ? [`name ${pseudo()}`] : []), ...texts];

function relay() {
  const socket = new WebSocket(socketUrl('/kbnet'));
  socket.binaryType = 'arraybuffer';
  socket.onmessage = ({ data }) => deliver(new Uint8Array(data));
  return packet => socket.readyState === WebSocket.OPEN && (socket.send(packet), true);
}

// Salon : chaque joueur ouvre un canal WebRTC vers l'hôte (10.0.0.1) ; le serveur ne fait que présenter les pages.
// Les étiquettes 10.0.0.<n> tiennent lieu d'adresses pour le moteur ; le port est toujours celui que connect prend par défaut.
const HOST_LABEL = '10.0.0.1';
// Une liaison directe s'ouvre en une seconde environ : au-delà, l'invité passe par le relais du serveur (/signal).
const RELAY_AFTER = 5000;

function room(name, hidden) {
  const signal = new WebSocket(socketUrl('/signal', { room: name, map: location.pathname.split('/').filter(Boolean).pop(), player: pseudo(), ...(hidden && { private: '1' }) }));
  const peers = new Map();
  let iceServers = [];
  let queue = Promise.resolve();
  const tell = (to, data) => signal.send(JSON.stringify({ to, data }));
  signal.binaryType = 'arraybuffer';

  function receive(label, payload) {
    const datagram = new Uint8Array(6 + payload.byteLength);
    datagram.set(label.split('.').map(Number));
    new DataView(datagram.buffer).setUint16(4, DEFAULT_PORT);
    datagram.set(payload, 6);
    deliver(datagram);
  }

  function askRelay() {
    if (stats.relayAsked || peers.get(HOST_LABEL)?.channel?.readyState === 'open') return;
    stats.relayAsked = true;
    tell(HOST_LABEL, { relay: 'hello' });
  }

  function attach(label, channel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => { stats.linked = true; stats.relayed = false; };
    channel.onmessage = ({ data }) => receive(label, new Uint8Array(data));
    peers.get(label).channel = channel;
  }

  function peer(label) {
    if (!peers.has(label)) {
      const connection = new RTCPeerConnection({ iceServers });
      connection.onicecandidate = ({ candidate }) => candidate && tell(label, { candidate });
      connection.ondatachannel = ({ channel }) => attach(label, channel);
      connection.onconnectionstatechange = () => { if (label === HOST_LABEL && connection.connectionState === 'failed') askRelay(); };
      peers.set(label, { connection, channel: null, candidates: [], relay: false });
    }
    return peers.get(label);
  }

  async function handle(message) {
    if (message.type === 'welcome') {
      iceServers = message.iceServers;
      stats.label = message.you;
      if (message.you === HOST_LABEL) return whenPlaying(() => true, ...named());
      const { connection } = peer(HOST_LABEL);
      attach(HOST_LABEL, connection.createDataChannel('kbnet', { ordered: false, maxRetransmits: 0 }));
      await connection.setLocalDescription();
      tell(HOST_LABEL, { description: connection.localDescription });
      setTimeout(askRelay, RELAY_AFTER);
      whenPlaying(() => stats.linked, ...named(`connect ${HOST_LABEL}`));
    } else if (message.type === 'signal') {
      const entry = peer(message.from);
      const { description, candidate, relay } = message.data;
      if (relay === 'hello') return void (entry.relay = true, tell(message.from, { relay: 'ack' }));
      if (relay === 'ack') {
        entry.relay = true;
        if (entry.channel?.readyState !== 'open') Object.assign(stats, { linked: true, relayed: true });
        return;
      }
      if (candidate && !entry.connection.remoteDescription) return void entry.candidates.push(candidate);
      if (candidate) return entry.connection.addIceCandidate(candidate);
      await entry.connection.setRemoteDescription(description);
      for (const pending of entry.candidates.splice(0)) await entry.connection.addIceCandidate(pending);
      if (description.type !== 'offer') return;
      await entry.connection.setLocalDescription();
      tell(message.from, { description: entry.connection.localDescription });
    } else if (message.type === 'leave') {
      if (message.label === HOST_LABEL) stats.hostLeft = true;
      peers.get(message.label)?.connection.close();
      peers.delete(message.label);
    }
  }
  signal.onmessage = ({ data }) => {
    if (typeof data !== 'string') return receive(new Uint8Array(data, 0, 4).join('.'), new Uint8Array(data, 4));
    queue = queue.then(() => handle(JSON.parse(data))).catch(error => console.error('kbnet', error));
  };
  signal.onclose = () => { if (!stats.label) stats.signalFailed = true; };
  // Chrome garde la page quittée dans son cache de navigation, WebSocket ouverte : le salon restait listé et l'hôte parti, jamais annoncé.
  addEventListener('pagehide', () => signal.close());

  return packet => {
    const entry = peers.get(packet.subarray(0, 4).join('.'));
    if (entry?.channel?.readyState === 'open') return entry.channel.send(packet.subarray(6)), true;
    if (!entry?.relay || signal.readyState !== WebSocket.OPEN) return false;
    const frame = new Uint8Array(packet.length - 2);
    frame.set(packet.subarray(0, 4));
    frame.set(packet.subarray(6), 4);
    signal.send(frame);
    return true;
  };
}

if (!globalThis.WorkerGlobalScope) {
  stats = globalThis.kbnet = { sent: 0, received: 0, dropped: 0, command };
  rings = new SharedArrayBuffer(RING_BYTES);
  mailbox = new SharedArrayBuffer(MAILBOX_BYTES);
  multi = new SharedArrayBuffer(4);
  shared = { rings, mailbox, multi };
  setInterval(postCommands, 50);
  const query = new URLSearchParams(location.search);
  if (query.get('room') || query.get('connect')) markMultiplayer();
  if (query.get('room')) transport = room(query.get('room'), query.get('private') === '1');
  else {
    transport = relay();
    whenPlaying(() => true, ...named(...(query.get('connect') ? [`connect ${query.get('connect')}`] : [])));
  }
}
