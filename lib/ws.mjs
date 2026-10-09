import { createHash } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

// Un datagramme UDP fait au plus 65 507 octets : la forme 16 bits de la longueur suffit toujours.
const frame = (opcode, payload) => Buffer.concat([
  payload.length < 126
    ? Buffer.from([0x80 | opcode, payload.length])
    : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]),
  payload,
]);

function reader(onFrame) {
  let buffered = Buffer.alloc(0);
  return chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 0x0f;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 127) throw new Error('trame WebSocket de plus de 64 Kio');
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      }
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4);
      const payload = Buffer.from(buffered.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
      buffered = buffered.subarray(offset + 4 + length);
      onFrame(opcode, payload);
    }
  };
}

export function accept(req, socket, onMessage, label) {
  const key = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  const read = reader((opcode, payload) => {
    if (opcode === OP_PING) socket.write(frame(OP_PONG, payload));
    else if (opcode === OP_CLOSE) socket.end(frame(OP_CLOSE, Buffer.alloc(0)));
    else onMessage(opcode, payload);
  });
  socket.on('data', chunk => {
    try {
      read(chunk);
    } catch (error) {
      console.error(label, error.message);
      socket.destroy();
    }
  });
  socket.on('error', () => socket.destroy());
  return { send: (opcode, payload) => socket.write(frame(opcode, payload)) };
}
