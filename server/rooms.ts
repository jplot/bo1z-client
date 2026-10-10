import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { keepalive } from './ws.ts';

type Room = { map: string | null; private: boolean; peers: Map<string, WebSocket>; players: Map<string, string> };
type Query = { room?: string; map?: string; player?: string; private?: string };

// Mise en relation WebRTC : le serveur ne transporte que les offres, réponses et candidats, jamais les paquets du jeu.
// Le moteur ne désigne un joueur que par une IPv4 : chaque page d'un salon reçoit 10.0.0.<n>, n = 1 étant l'hôte.
export function rooms(app: FastifyInstance, iceServers: unknown) {
  const all = new Map<string, Room>();
  const refuse = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = `${request.headers['x-forwarded-proto'] ?? 'http'}://${request.headers.host}`;
    if (!(request.query as Query).room || request.headers.origin !== origin) return reply.code(403).send();
  };
  app.get('/signal', { websocket: true, preValidation: refuse }, (socket, request) => {
    const query = request.query as Query;
    const name = query.room!;
    const room = all.get(name) ?? all.set(name, { map: query.map ?? null, private: query.private === '1', peers: new Map(), players: new Map() }).get(name)!;
    let n = 1;
    while (room.peers.has(`10.0.0.${n}`)) n++;
    const label = `10.0.0.${n}`;
    const source = Buffer.from(label.split('.').map(Number));
    keepalive(socket);
    socket.on('message', (data: Buffer, binary: boolean) => {
      // Relais quand la liaison directe échoue : [place de destination][paquet] arrive, [place d'origine][paquet] repart.
      if (binary) {
        if (data.length > 4) room.peers.get([...data.subarray(0, 4)].join('.'))?.send(Buffer.concat([source, data.subarray(4)]));
        return;
      }
      try {
        const { to, data: signal } = JSON.parse(data.toString());
        room.peers.get(to)?.send(JSON.stringify({ type: 'signal', from: label, data: signal }));
      } catch (error) {
        console.error('signal', (error as Error).message);
        socket.terminate();
      }
    });
    room.peers.set(label, socket);
    room.players.set(label, query.player ?? '');
    socket.send(JSON.stringify({ type: 'welcome', you: label, iceServers }));
    socket.on('close', () => {
      room.peers.delete(label);
      room.players.delete(label);
      if (!room.peers.size) all.delete(name);
      for (const other of room.peers.values()) other.send(JSON.stringify({ type: 'leave', label }));
    });
  });

  const describe = ([name, room]: [string, Room]) => ({ name, map: room.map, ...(room.private && { private: true }), players: room.peers.size,
    members: [...room.players].map(([label, pseudo]) => ({ label, pseudo })) });
  app.get('/rooms', async (request, reply) => {
    const { code } = request.query as { code?: string };
    const found = code === undefined ? [...all].filter(([, room]) => !room.private) : all.has(code) ? [[code, all.get(code)!] as [string, Room]] : [];
    return reply.header('cache-control', 'no-store').send(found.map(describe));
  });
}
