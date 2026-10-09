import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { accept, OP_BINARY } from './ws.mjs';

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
export function udpBridge(httpPort, udpPort) {
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
    page.send(OP_BINARY, Buffer.concat([header, payload]));
  });
  udp.bind(udpPort, () => console.log(`UDP ${udpPort} : ${['127.0.0.1', ...lanAddresses()].map(address => `${address}:${udpPort}`).join(', ')}`));

  let current = null;
  return (req, socket) => {
    if (!origins.includes(req.headers.origin)) return socket.destroy();
    current?.destroy();
    current = socket;
    page = accept(req, socket, (opcode, payload) => {
      if (opcode !== OP_BINARY) return;
      const [address, port] = [[...payload.subarray(0, 4)].join('.'), payload.readUInt16BE(4)];
      trace('→', `${address}:${port}`, payload.subarray(6));
      udp.send(payload.subarray(6), port, address, error => error && console.error('udp', error.message));
    }, 'kbnet');
    console.log('page connectée au pont');
    socket.on('close', () => { if (current === socket) page = current = null; });
  };
}
