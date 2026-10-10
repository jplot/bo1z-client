import type { WebSocket } from 'ws';

// Le routeur Heroku coupe une WebSocket restée 55 s sans un octet (H15) : le salon perdait alors ses joueurs.
const KEEPALIVE_MS = 30_000;

export function keepalive(socket: Pick<WebSocket, 'ping' | 'on'>) {
  const timer = setInterval(() => socket.ping(), KEEPALIVE_MS);
  socket.on('close', () => clearInterval(timer));
}
