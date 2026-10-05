import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyToken } from './auth.ts';
import type { TelemetryEvent } from './types.ts';

interface Client {
  socket: WebSocket;
  userId: string;
  homeId: string | null;
}

const clients = new Set<Client>();

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/realtime' });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/realtime', 'http://localhost');
    const token = url.searchParams.get('token');
    const userId = token ? verifyToken(token) : null;
    if (!userId) {
      socket.close(4001, 'unauthorized');
      return;
    }

    const client: Client = { socket, userId, homeId: url.searchParams.get('homeId') };
    clients.add(client);
    send(client, { type: 'hello', payload: { at: Date.now(), connections: clients.size } });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; homeId?: string };
        if (msg.homeId) client.homeId = msg.homeId;
        if (msg.type === 'subscribe' && client.homeId) {
          send(client, { type: 'subscribed', payload: { homeId: client.homeId }, at: Date.now() });
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  setInterval(() => {
    for (const c of clients) if (c.socket.readyState === WebSocket.OPEN) c.socket.ping();
  }, 30000).unref();
}

function send(client: Client, event: TelemetryEvent | { type: string; payload: unknown; at?: number }): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  client.socket.send(JSON.stringify(event));
}

/** Fan a simulated device event out to every client watching that home. */
export function broadcast(event: TelemetryEvent): void {
  const frame = JSON.stringify(event);
  for (const c of clients) {
    if (c.homeId && c.homeId !== event.homeId) continue;
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(frame);
  }
}

export function connectedClients(): number {
  return clients.size;
}