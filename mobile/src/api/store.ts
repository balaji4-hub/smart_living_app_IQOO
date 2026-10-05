import { create } from 'zustand';
import { api, ApiError, loadToken, setToken } from './client';
import { realtime } from './realtime';
import type {
  AiMessage,
  Automation,
  Device,
  DeviceState,
  EnergyReport,
  HomeEvent,
  HomeSnapshot,
  Insight,
  Presence,
  Profile,
  Scene,
  SimState,
  Sun,
  Weather,
} from './types';

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

interface AppState {
  booted: boolean;
  authed: boolean;
  authError: string | null;
  busy: boolean;

  profile: Profile | null;
  snapshot: HomeSnapshot | null;
  devices: Record<string, Device>;
  scenes: Scene[];
  automations: Automation[];
  energy: EnergyReport | null;
  insights: Insight[];
  events: HomeEvent[];
  chat: AiMessage[];
  suggestions: string[];
  sim: SimState | null;

  liveWatts: number;
  liveByCategory: Record<string, number>;
  connected: boolean;
  selectedDeviceId: string | null;
  focusedRoomId: string | null;
  toast: Toast | null;

  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => Promise<void>;

  refreshAll: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  refreshInsights: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshEnergy: () => Promise<void>;
  refreshChat: () => Promise<void>;
  refreshAutomations: () => Promise<void>;
  refreshScenes: () => Promise<void>;
  refreshSim: () => Promise<void>;

  command: (deviceId: string, command: string, args?: Record<string, unknown>) => Promise<void>;
  runScene: (sceneId: string) => Promise<void>;
  toggleAutomation: (id: string, enabled: boolean) => Promise<void>;
  runAutomation: (id: string) => Promise<void>;
  removeAutomation: (id: string) => Promise<void>;
  createAutomation: (draft: Partial<Automation>) => Promise<void>;
  sendChat: (text: string) => Promise<void>;
  addDevice: (input: { name: string; kind: Device['kind']; roomId?: string | null }) => Promise<void>;
  toggleFavorite: (deviceId: string) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  setTimeScale: (scale: number) => Promise<void>;

  selectDevice: (id: string | null) => void;
  focusRoom: (id: string | null) => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  clearToast: () => void;
}

let toastSeq = 0;
let unsubRealtime: Array<() => void> = [];

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  authed: false,
  authError: null,
  busy: false,

  profile: null,
  snapshot: null,
  devices: {},
  scenes: [],
  automations: [],
  energy: null,
  insights: [],
  events: [],
  chat: [],
  suggestions: [],
  sim: null,

  liveWatts: 0,
  liveByCategory: {},
  connected: false,
  selectedDeviceId: null,
  focusedRoomId: null,
  toast: null,

  async boot() {
    const token = await loadToken();
    if (!token) {
      set({ booted: true });
      return;
    }
    try {
      const profile = await api.me();
      set({ authed: true, profile });
      await get().refreshAll();
      realtime.connect(token, profile.home.id);
      wireRealtime(set, get);
      set({ booted: true });
    } catch {
      await setToken(null);
      set({ authed: false, booted: true });
    }
  },

  async login(email, password) {
    set({ authError: null, busy: true });
    try {
      const res = await api.login(email, password);
      await setToken(res.token);
      const profile = await api.me();
      set({ authed: true, profile });
      await get().refreshAll();
      realtime.connect(res.token, profile.home.id);
      wireRealtime(set, get);
      return true;
    } catch (error) {
      set({ authError: error instanceof ApiError ? error.message : 'Could not sign in' });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async register(email, password, name) {
    set({ authError: null, busy: true });
    try {
      const res = await api.register(email, password, name);
      await setToken(res.token);
      const profile = await api.me();
      set({ authed: true, profile });
      await get().refreshAll();
      realtime.connect(res.token, profile.home.id);
      wireRealtime(set, get);
      return true;
    } catch (error) {
      set({ authError: error instanceof ApiError ? error.message : 'Could not create the account' });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async logout() {
    realtime.disconnect();
    unsubRealtime.forEach((fn) => fn());
    unsubRealtime = [];
    await setToken(null);
    set({
      authed: false,
      profile: null,
      devices: {},
      scenes: [],
      automations: [],
      energy: null,
      insights: [],
      events: [],
      chat: [],
      selectedDeviceId: null,
      connected: false,
    });
  },

  async refreshAll() {
    await Promise.allSettled([
      get().refreshSnapshot(),
      get().refreshDevices(),
      get().refreshScenes(),
      get().refreshAutomations(),
      get().refreshInsights(),
      get().refreshEvents(),
      get().refreshEnergy(),
      get().refreshChat(),
      get().refreshSim(),
    ]);
  },

  async refreshSnapshot() {
    const snapshot = await api.home();
    set({ snapshot, liveWatts: snapshot.power.totalWatts, liveByCategory: snapshot.power.byCategory });
  },

  async refreshDevices() {
    const { devices } = await api.devices();
    set({ devices: Object.fromEntries(devices.map((d) => [d.id, d])) });
  },

  async refreshScenes() {
    const { scenes } = await api.scenes();
    set({ scenes });
  },

  async refreshAutomations() {
    const { automations } = await api.automations();
    set({ automations });
  },

  async refreshInsights() {
    const { insights } = await api.insights();
    set({ insights });
  },

  async refreshEvents() {
    const { events } = await api.events();
    set({ events });
  },

  async refreshEnergy() {
    set({ energy: await api.energy() });
  },

  async refreshChat() {
    const { messages, suggestions } = await api.aiHistory();
    set({ chat: messages, suggestions });
  },

  async refreshSim() {
    set({ sim: await api.sim() });
  },

  async command(deviceId, command, args) {
    const before = get().devices[deviceId];
    if (before) {
      // Optimistic flip so the UI feels instant.
      const optimistic: DeviceState = { ...before.state };
      if (command === 'toggle') optimistic.power = before.state.power === 'on' ? 'off' : 'on';
      if (command === 'turnOn') optimistic.power = 'on';
      if (command === 'turnOff') optimistic.power = 'off';
      if (command === 'lock') optimistic.locked = true;
      if (command === 'unlock') optimistic.locked = false;
      set({ devices: { ...get().devices, [deviceId]: { ...before, state: optimistic } } });
    }
    try {
      const res = await api.command(deviceId, command, args);
      set({ devices: { ...get().devices, [deviceId]: res.device } });
      void get().refreshSnapshot();
    } catch (error) {
      if (before) set({ devices: { ...get().devices, [deviceId]: before } });
      get().showToast(error instanceof ApiError ? error.message : 'Command failed', 'error');
    }
  },

  async runScene(sceneId) {
    try {
      await api.runScene(sceneId);
      await get().refreshDevices();
      void get().refreshEvents();
      const scene = get().scenes.find((s) => s.id === sceneId);
      get().showToast(`${scene?.name ?? 'Scene'} activated`, 'ok');
    } catch (error) {
      get().showToast(error instanceof ApiError ? error.message : 'Scene failed', 'error');
    }
  },

  async toggleAutomation(id, enabled) {
    const prev = get().automations;
    set({ automations: prev.map((a) => (a.id === id ? { ...a, enabled } : a)) });
    try {
      await api.updateAutomation(id, { enabled });
      void get().refreshEvents();
    } catch {
      set({ automations: prev });
      get().showToast('Could not update automation', 'error');
    }
  },

  async runAutomation(id) {
    try {
      await api.runAutomation(id);
      await get().refreshDevices();
      void get().refreshEvents();
      get().showToast('Automation executed', 'ok');
    } catch (error) {
      get().showToast(error instanceof ApiError ? error.message : 'Automation failed', 'error');
    }
  },

  async removeAutomation(id) {
    try {
      await api.removeAutomation(id);
      set({ automations: get().automations.filter((a) => a.id !== id) });
      get().showToast('Automation deleted', 'info');
    } catch {
      get().showToast('Could not delete automation', 'error');
    }
  },

  async createAutomation(draft) {
    try {
      await api.createAutomation(draft);
      await get().refreshAutomations();
      get().showToast('Automation created', 'ok');
    } catch (error) {
      get().showToast(error instanceof ApiError ? error.message : 'Could not create automation', 'error');
    }
  },

  async sendChat(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    set({ chat: [...get().chat, { role: 'user', content: trimmed }] });
    try {
      const res = await api.aiChat(trimmed);
      set({
        chat: [...get().chat, { role: 'assistant', content: res.reply, meta: res.meta }],
        suggestions: res.suggestions,
      });
      void get().refreshEvents();
      void get().refreshDevices();
      void get().refreshSnapshot();
    } catch (error) {
      set({
        chat: [
          ...get().chat,
          { role: 'assistant', content: error instanceof ApiError ? error.message : 'Something went wrong talking to the assistant.' },
        ],
      });
    }
  },

  async addDevice(input) {
    try {
      await api.createDevice(input);
      await get().refreshDevices();
      await get().refreshSnapshot();
      get().showToast(`${input.name} paired`, 'ok');
    } catch (error) {
      get().showToast(error instanceof ApiError ? error.message : 'Could not pair device', 'error');
    }
  },

  async toggleFavorite(deviceId) {
    const d = get().devices[deviceId];
    if (!d) return;
    const next = !d.favorite;
    set({ devices: { ...get().devices, [deviceId]: { ...d, favorite: next } } });
    try {
      await api.updateDevice(deviceId, { favorite: next });
    } catch {
      set({ devices: { ...get().devices, [deviceId]: d } });
    }
  },

  async removeDevice(deviceId) {
    const d = get().devices[deviceId];
    try {
      await api.removeDevice(deviceId);
      const devices = { ...get().devices };
      delete devices[deviceId];
      set({ devices, selectedDeviceId: null });
      void get().refreshSnapshot();
      get().showToast(`${d?.name ?? 'Device'} removed`, 'info');
    } catch {
      get().showToast('Could not remove device', 'error');
    }
  },

  async setTimeScale(scale) {
    try {
      const res = await api.setSimScale(scale);
      set({ sim: get().sim ? { ...get().sim!, scale: res.scale } : get().sim });
    } catch {
      get().showToast('Could not change time speed', 'error');
    }
  },

  selectDevice: (id) => set({ selectedDeviceId: id }),
  focusRoom: (id) => set({ focusedRoomId: id }),

  showToast(text, tone = 'info') {
    const id = ++toastSeq;
    set({ toast: { id, text, tone } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3200);
  },

  clearToast: () => set({ toast: null }),
}));

/** Attach realtime listeners once per session. */
function wireRealtime(set: (partial: Partial<AppState>) => void, get: () => AppState): void {
  unsubRealtime.forEach((fn) => fn());
  unsubRealtime = [];

  unsubRealtime.push(
    realtime.on('telemetry', (msg) => {
      const id = msg.deviceId;
      if (!id) return;
      const d = get().devices[id];
      if (!d) return;
      set({ devices: { ...get().devices, [id]: { ...d, state: { ...d.state, ...msg.payload } } } });
    }),
  );

  unsubRealtime.push(
    realtime.on('state', (msg) => {
      const id = msg.deviceId;
      if (!id) return;
      const d = get().devices[id];
      if (!d) return;
      set({ devices: { ...get().devices, [id]: { ...d, state: msg.payload } } });
    }),
  );

  unsubRealtime.push(
    realtime.on('energy', (msg) => {
      set({ liveWatts: msg.payload.totalWatts, liveByCategory: msg.payload.byCategory });
    }),
  );

  unsubRealtime.push(
    realtime.on('weather', (msg) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({
        snapshot: {
          ...snap,
          weather: msg.payload.weather as Weather,
          sun: msg.payload.sun as Sun,
          localMinutes: msg.payload.localMinutes,
          localTime: formatMinutes(msg.payload.localMinutes),
        },
      });
    }),
  );

  unsubRealtime.push(
    realtime.on('presence', (msg) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({ snapshot: { ...snap, presence: msg.payload as Presence } });
    }),
  );

  unsubRealtime.push(
    realtime.on('automation', (msg) => {
      get().showToast(`${msg.payload.name} just ran`, 'ok');
      void get().refreshEvents();
      void get().refreshAutomations();
    }),
  );

  unsubRealtime.push(
    realtime.on('event', () => {
      void get().refreshEvents();
    }),
  );

  unsubRealtime.push(
    realtime.onStatus((connected) => {
      const was = get().connected;
      set({ connected });
      // Re-sync after a reconnect so nothing stale is left on screen.
      if (connected && !was) void get().refreshAll();
    }),
  );
}

export function formatMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function currencySymbol(code: string): string {
  return code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code === 'INR' ? '₹' : '';
}