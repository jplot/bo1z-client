import { accept, OP_TEXT } from './ws.mjs';

const json = value => Buffer.from(JSON.stringify(value));

// Mise en relation WebRTC : le serveur ne transporte que les offres, réponses et candidats, jamais les paquets du jeu.
// Le moteur ne désigne un joueur que par une IPv4 : chaque page d'un salon reçoit 10.0.0.<n>, n = 1 étant l'hôte.
export function signaling(iceServers) {
  const rooms = new Map();
  const upgrade = (req, socket) => {
    const query = new URL(req.url, 'http://127.0.0.1').searchParams;
    const name = query.get('room');
    const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
    if (!name || req.headers.origin !== origin) return socket.destroy();
    const room = rooms.get(name) ?? rooms.set(name, { map: query.get('map'), peers: new Map(), players: new Map() }).get(name);
    let n = 1;
    while (room.peers.has(`10.0.0.${n}`)) n++;
    const label = `10.0.0.${n}`;
    const peer = accept(req, socket, (opcode, payload) => {
      if (opcode !== OP_TEXT) return;
      const { to, data } = JSON.parse(payload);
      room.peers.get(to)?.send(OP_TEXT, json({ type: 'signal', from: label, data }));
    }, 'signal');
    room.peers.set(label, peer);
    room.players.set(label, query.get('player') ?? '');
    peer.send(OP_TEXT, json({ type: 'welcome', you: label, iceServers }));
    socket.on('close', () => {
      room.peers.delete(label);
      room.players.delete(label);
      if (!room.peers.size) rooms.delete(name);
      for (const other of room.peers.values()) other.send(OP_TEXT, json({ type: 'leave', label }));
    });
  };
  const list = () => [...rooms].map(([name, { map, peers, players }]) => ({ name, map, players: peers.size, names: [...players.values()] }));
  return { upgrade, list };
}
