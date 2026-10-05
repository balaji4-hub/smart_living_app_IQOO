import { BASE_URL } from './client';
import type { DeviceState } from './types';

export type RealtimeMessage =
  | { type: 'hello'; payload: { at: number; connections: number } }
  | { type: 'subscribed'; payload: { homeId: string } }
  | { type: 'telemetry'; deviceId?: string; payload: Partial<DeviceState>; at: number }
  | { type: 'state'; deviceId?: string; payload: DeviceState; at: number }
  | { type: 'energy'; payload: { totalWatts: number; byCategory: Record<string, number>; at: number }; at: number }
  | { type: 'weather'; payload: { weather: unknown; sun: unknown; localMinutes: number; daylight: boolean }; at: number }
  | { type: 'presence'; payload: { home: boolean; peopleHome: number; asleep: boolean }; at: number }
  | { type: 'automation'; payload: { id: string; name: string; body: string }; at: number }
  | { type: 'event'; payload: { kind: string; title?: string }; at: number };

type Handler = (msg: RealtimeMessage) => void;
type Narrow<K extends RealtimeMessage['type']> = Extract<RealtimeMessage, { type: K }>;

/**
 * Auto-reconnecting WebSocket client. Keeps a single socket alive for the
 * whole session and lets subscribers fan out by message type.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<RealtimeMessage['type'], Set<Handler>>();
  private anyHandlers = new Set<Handler>();
  private token: string | null = null;
  private homeId: string | null = null;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;
  private statusHandlers = new Set<(connected: boolean) => void>();

  get connected(): boolean {
    return this.socket?.readyState === 1;
  }

  /** Subscribe to connect/disconnect transitions. Fires immediately with current state. */
  onStatus(handler: (connected: boolean) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.connected);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(connected: boolean): void {
    this.statusHandlers.forEach((handler) => handler(connected));
  }

  connect(token: string, homeId: string): void {
    this.token = token;
    this.homeId = homeId;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.token || !this.homeId) return;
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;

    const url = `${BASE_URL.replace(/^http/, 'ws')}/realtime?token=${encodeURIComponent(this.token)}&homeId=${encodeURIComponent(this.homeId)}`;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.retry = 0;
      this.startHeartbeat();
      this.setStatus(true);
      this.send({ type: 'subscribe', homeId: this.homeId });
    };

    this.socket.onmessage = (event) => {
      let msg: RealtimeMessage;
      try {
        msg = JSON.parse(String(event.data)) as RealtimeMessage;
      } catch {
        return;
      }
      this.emit(msg);
    };

    this.socket.onerror = () => {
      /* onclose handles retry */
    };

    this.socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      this.setStatus(false);
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(15000, 600 * 2 ** this.retry);
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /** WebSocket in React Native has no ping/pong, so send an app-level frame. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  send(data: unknown): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(data));
  }

  on<K extends RealtimeMessage['type']>(type: K, handler: (msg: Narrow<K>) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    const wrapped: Handler = (msg) => {
      if (msg.type === type) handler(msg as Narrow<K>);
    };
    set.add(wrapped);
    this.handlers.set(type, set);
    return () => set.delete(wrapped);
  }

  onAny(handler: Handler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  private emit(msg: RealtimeMessage): void {
    this.handlers.get(msg.type)?.forEach((h) => h(msg));
    this.anyHandlers.forEach((h) => h(msg));
  }

  disconnect(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus(false);
  }
}

export const realtime = new RealtimeClient();