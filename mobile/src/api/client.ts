import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type {
  AiMessage,
  Automation,
  Device,
  DeviceKind,
  EnergyReport,
  HomeEvent,
  HomeSnapshot,
  Insight,
  Profile,
  Scene,
  SimState,
} from './types';

/**
 * Resolve the backend base URL.
 *
 * On Android emulators `localhost` is the emulator itself, so we map the
 * standard host to 10.0.2.2. A physical device on the same Wi-Fi needs the
 * machine's LAN address, which can be pinned with EXPO_PUBLIC_API_URL.
 */
function resolveBaseUrl(): string {
  const pinned = process.env.EXPO_PUBLIC_API_URL;
  if (pinned) return pinned.replace(/\/$/, '');

  const host = process.env.EXPO_PUBLIC_HOST;
  if (host) return `http://${host}:4000`;

  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const BASE_URL = resolveBaseUrl();

const TOKEN_KEY = 'smart_living_token';

let token: string | null = null;

/** Never let a storage call wedge app boot; a stuck promise shows no error. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export async function loadToken(): Promise<string | null> {
  if (token) return token;
  try {
    token = await withTimeout(SecureStore.getItemAsync(TOKEN_KEY), 2500, null);
  } catch {
    token = null;
  }
  return token;
}

export async function setToken(next: string | null): Promise<void> {
  token = next;
  try {
    if (next) await withTimeout(SecureStore.setItemAsync(TOKEN_KEY, next), 2500, undefined);
    else await withTimeout(SecureStore.deleteItemAsync(TOKEN_KEY), 2500, undefined);
  } catch {
    /* SecureStore is unavailable on web; in-memory token still works. */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError(`Cannot reach the Smart Living server at ${BASE_URL}. Is it running?`, 0);
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  baseUrl: BASE_URL,

  demoCredentials: () => request<{ email: string; password: string; name: string }>('/api/demo-credentials'),

  login: (email: string, password: string) =>
    post<{ token: string; user: Profile['user']; homeId: string | null }>('/api/auth/login', { email, password }),

  register: (email: string, password: string, name: string) =>
    post<{ token: string; user: Profile['user']; homeId: string | null }>('/api/auth/register', { email, password, name }),

  me: () => request<Profile>('/api/me'),

  updateMe: (body: Partial<{ name: string; currency: string; energyRate: number; homeName: string }>) =>
    patch<{ ok: boolean }>('/api/me', body),

  home: () => request<HomeSnapshot>('/api/home'),

  devices: (params?: { room?: string; kind?: string; favorite?: string }) => {
    const q = new URLSearchParams();
    if (params?.room) q.set('room', params.room);
    if (params?.kind) q.set('kind', params.kind);
    if (params?.favorite) q.set('favorite', params.favorite);
    const qs = q.toString();
    return request<{ devices: Device[] }>(`/api/devices${qs ? `?${qs}` : ''}`);
  },

  device: (id: string) => request<{ device: Device; telemetry: Array<Record<string, number | string>> }>(`/api/devices/${id}`),

  createDevice: (body: { name: string; kind: DeviceKind; roomId?: string | null; manufacturer?: string; model?: string }) =>
    post<{ device: Device }>('/api/devices', body),

  updateDevice: (id: string, body: Partial<{ name: string; favorite: boolean; roomId: string | null }>) =>
    patch<{ device: Device }>(`/api/devices/${id}`, body),

  removeDevice: (id: string) => del<{ ok: boolean }>(`/api/devices/${id}`),

  command: (id: string, command: string, args?: Record<string, unknown>) =>
    post<{ results: Array<{ message: string; ok: boolean }>; device: Device }>(`/api/devices/${id}/command`, { command, args }),

  scenes: () => request<{ scenes: Scene[] }>('/api/scenes'),

  runScene: (id: string) => post<{ ok: boolean; results: Array<{ name: string; message: string }> }>(`/api/scenes/${id}/run`),

  automations: () => request<{ automations: Automation[] }>('/api/automations'),

  createAutomation: (body: Partial<Automation>) => post<{ automation: Automation }>('/api/automations', body),

  updateAutomation: (id: string, body: Partial<Automation>) => patch<{ automation: Automation }>(`/api/automations/${id}`, body),

  removeAutomation: (id: string) => del<{ ok: boolean }>(`/api/automations/${id}`),

  runAutomation: (id: string) => post<{ ok: boolean }>(`/api/automations/${id}/run`),

  energy: () => request<EnergyReport>('/api/energy'),

  insights: () => request<{ insights: Insight[] }>('/api/insights'),

  events: () => request<{ events: HomeEvent[] }>('/api/events'),

  aiHistory: () => request<{ messages: AiMessage[]; suggestions: string[] }>('/api/ai/history'),

  aiChat: (message: string) =>
    post<{ reply: string; meta: Record<string, unknown>; plan: { intent: string; confidence: number }; suggestions: string[] }>(
      '/api/ai/chat',
      { message },
    ),

  sim: () => request<SimState>('/api/sim'),

  setSimScale: (scale: number) => post<{ scale: number }>('/api/sim/scale', { scale }),
};