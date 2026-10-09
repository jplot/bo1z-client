// Une file par sock, un seul producteur (la page) et un seul consommateur (le pthread qui appelle NET_GetLoopPacket
// pour ce sock) : head et tail suffisent, à condition de les publier après l'écriture ou la lecture du slot.
export const SOCKS = 2;
export const SLOT_DATA = 4096;
const SLOTS = 64;
const SLOT_BYTES = 16 + SLOT_DATA;
const HEADER_BYTES = 16;
export const RING_BYTES = HEADER_BYTES + SOCKS * SLOTS * SLOT_BYTES;

const slotOffset = (sock, counter) => HEADER_BYTES + (sock * SLOTS + (counter % SLOTS)) * SLOT_BYTES;

export function push(rings, sock, address, data) {
  const header = new Int32Array(rings, 0, SOCKS * 2);
  const head = header[sock * 2];
  if (head - Atomics.load(header, sock * 2 + 1) >= SLOTS) return false;
  const offset = slotOffset(sock, head);
  new DataView(rings).setUint32(offset, data.length, true);
  new Uint8Array(rings, offset + 4, 6).set(address);
  new Uint8Array(rings, offset + 16, data.length).set(data);
  Atomics.store(header, sock * 2, head + 1);
  return true;
}

export function take(rings, sock, copy) {
  const header = new Int32Array(rings, 0, SOCKS * 2);
  const tail = header[sock * 2 + 1];
  if (Atomics.load(header, sock * 2) === tail) return false;
  const offset = slotOffset(sock, tail);
  const length = new DataView(rings).getUint32(offset, true);
  copy(new Uint8Array(rings, offset + 4, 6), new Uint8Array(rings, offset + 16, length));
  Atomics.store(header, sock * 2 + 1, tail + 1);
  return true;
}

// Boîte aux lettres à un seul message : longueur en tête, publiée après le texte, remise à 0 par le lecteur une fois copié.
export const MAILBOX_BYTES = 4 + 1024;

export function post(mailbox, bytes) {
  const length = new Int32Array(mailbox, 0, 1);
  if (Atomics.load(length, 0)) return false;
  new Uint8Array(mailbox, 4, bytes.length).set(bytes);
  Atomics.store(length, 0, bytes.length);
  return true;
}

export function receive(mailbox, copy) {
  const length = new Int32Array(mailbox, 0, 1);
  const count = Atomics.load(length, 0);
  if (!count) return false;
  copy(new Uint8Array(mailbox, 4, count));
  Atomics.store(length, 0, 0);
  return true;
}
