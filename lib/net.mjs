import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_BINARY = 0x2;
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

const lanAddresses = () => Object.values(networkInterfaces()).flat()
  .filter(({ family, internal }) => family === 'IPv4' && !internal).map(({ address }) => address);

// Charge UDP : sock émetteur, puis le paquet du moteur ; 0xFFFFFFFF en tête marque une commande hors-bande en texte.
const describe = payload => (payload.length >= 5 && payload.readInt32LE(1) === -1
  ? JSON.stringify(payload.subarray(5, 85).toString('latin1'))
  : `netchan ${payload.length - 1} octets`);
const trace = process.env.KBNET_TRACE === '1'
  ? (arrow, peer, payload) => console.log(`${arrow} ${peer} sock ${payload[0]} ${describe(payload)}`)
  : () => {};

// Datagrammes entre page et relais : 4 octets d'IPv4, 2 octets de port big-endian, puis la charge du moteur.
export function attachNet(server, httpPort, udpPort) {
  // Les WebSocket échappent à CORS : sans ce filtre, tout site ouvert pourrait émettre de l'UDP via le relais.
  const origins = [`http://127.0.0.1:${httpPort}`, `http://localhost:${httpPort}`];
  const udp = dgram.createSocket('udp4');
  let page = null;
  const peers = new Set();

  udp.on('message', (payload, from) => {
    const peer = `${from.address}:${from.port}`;
    if (!peers.has(peer)) console.log(`UDP : premier paquet de ${peer}`);
    peers.add(peer);
    trace('←', peer, payload);
    if (!page) return;
    const header = Buffer.alloc(6);
    from.address.split('.').forEach((byte, i) => { header[i] = Number(byte); });
    header.writeUInt16BE(from.port, 4);
    page.write(frame(OP_BINARY, Buffer.concat([header, payload])));
  });
  udp.bind(udpPort, () => console.log(`UDP ${udpPort} : ${['127.0.0.1', ...lanAddresses()].map(address => `${address}:${udpPort}`).join(', ')}`));

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/kbnet' || !origins.includes(req.headers.origin)) return socket.destroy();
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    page?.destroy();
    page = socket;
    console.log('page connectée au pont');
    const read = reader((opcode, payload) => {
      if (opcode === OP_BINARY) {
        const [address, port] = [[...payload.subarray(0, 4)].join('.'), payload.readUInt16BE(4)];
        trace('→', `${address}:${port}`, payload.subarray(6));
        udp.send(payload.subarray(6), port, address, error => error && console.error('udp', error.message));
      }
      else if (opcode === OP_PING) socket.write(frame(OP_PONG, payload));
      else if (opcode === OP_CLOSE) socket.end(frame(OP_CLOSE, Buffer.alloc(0)));
    });
    socket.on('data', chunk => {
      try {
        read(chunk);
      } catch (error) {
        console.error('kbnet', error.message);
        socket.destroy();
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { if (page === socket) page = null; });
  });
}
