import { accept, OP_TEXT } from './ws.mjs';

const json = value => Buffer.from(JSON.stringify(value));

// Mise en relation WebRTC : le serveur ne transporte que les offres, réponses et candidats, jamais les paquets du jeu.
// Le moteur ne désigne un joueur que par une IPv4 : chaque page d'un salon reçoit 10.0.0.<n>, n = 1 étant l'hôte.
export function signaling(iceServers) {
  const rooms = new Map();
  return (req, socket) => {
    const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('room');
    const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
    if (!name || req.headers.origin !== origin) return socket.destroy();
    const room = rooms.get(name) ?? rooms.set(name, new Map()).get(name);
    let n = 1;
    while (room.has(`10.0.0.${n}`)) n++;
    const label = `10.0.0.${n}`;
    const peer = accept(req, socket, (opcode, payload) => {
      if (opcode !== OP_TEXT) return;
      const { to, data } = JSON.parse(payload);
      room.get(to)?.send(OP_TEXT, json({ type: 'signal', from: label, data }));
    }, 'signal');
    room.set(label, peer);
    peer.send(OP_TEXT, json({ type: 'welcome', you: label, iceServers }));
    socket.on('close', () => {
      room.delete(label);
      if (!room.size) rooms.delete(name);
      for (const other of room.values()) other.send(OP_TEXT, json({ type: 'leave', label }));
    });
  };
}
