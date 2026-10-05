import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { all, db, get, run } from './db.ts';
import { hashPassword, issueToken, requireAuth, verifyPassword, type AuthedRequest } from './auth.ts';
import {
  aiHistory,
  bumpAutomationRun,
  bumpSceneRun,
  deleteDevice,
  energyRange,
  getAutomation,
  getDevice,
  getDevicesByIds,
  getRoom,
  getScene,
  insertAiMessage,
  insertDevice,
  insertEvent,
  insertRoom,
  insertTelemetry,
  listAutomations,
  listDevices,
  listEvents,
  listRooms,
  roundState,
  listScenes,
  patchDevice,
  pruneTelemetry,
  recentTelemetry,
  saveDeviceState,
  uid,
  upsertEnergySample,
} from './store.ts';
import { checkConditions, evaluateTrigger, executeCommand, fmtMinutes, runAutomation, type CommandResult } from './automation.ts';
import { attachRealtime, broadcast, connectedClients } from './realtime.ts';
import { isSeeded, seed } from './seed.ts';
import { powerSummary, stepDevice, CATEGORY } from './sim/devices.ts';
import { localMinutesFor, setTimeScale, simNow, timeScale } from './sim/clock.ts';
import { simulatePresence, simulateWeather, sunPosition, uvIndexFor, type HomeContext } from './sim/physics.ts';
import { buildEnergyReport, buildInsights, currencySymbol } from './analytics.ts';
import { parseIntent, planViaLlm, summariseResults, SUGGESTIONS, type EngineContext } from './ai/intents.ts';
import type { Action, DeviceKind, DeviceState, ParsedDevice } from './types.ts';

const PORT = Number(process.env.PORT ?? 4000);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request log: invaluable when the phone is on a tunnel and you cannot see the
// device console. Skips health probes and websocket upgrades to limit noise.
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const mark = res.statusCode >= 400 ? '!' : ' ';
    console.log(`${mark} ${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms`);
  });
  next();
});

// ---------------------------------------------------------------- simulation

interface HomeRuntime {
  homeId: string;
  lat: number;
  lon: number;
  ctx: HomeContext;
  lastEnergyMinute: number;
  firedCooldowns: Map<string, number>;
}

const runtimes = new Map<string, HomeRuntime>();

function runtimeFor(homeId: string, lat: number, lon: number): HomeRuntime {
  const existing = runtimes.get(homeId);
  if (existing) return existing;
  const now = simNow();
  const sun = sunPosition(lat, lon, now);
  const weather = { ...simulateWeather(lat, now), uvIndex: 0 };
  weather.uvIndex = uvIndexFor(sun, weather);
  const rt: HomeRuntime = {
    homeId,
    lat,
    lon,
    lastEnergyMinute: Math.floor(now / 60000),
    firedCooldowns: new Map(),
    ctx: {
      homeId,
      lat,
      lon,
      rooms: [],
      presence: simulatePresence(now, 3),
      weather,
      sun,
      tickSeconds: Math.floor(now / 1000),
    },
  };
  runtimes.set(homeId, rt);
  return rt;
}

function refreshContext(rt: HomeRuntime): void {
  const now = simNow();
  const sun = sunPosition(rt.lat, rt.lon, now);
  const weather = simulateWeather(rt.lat, now);
  weather.uvIndex = uvIndexFor(sun, weather);
  rt.ctx = {
    ...rt.ctx,
    rooms: listRooms(rt.homeId).map((r) => ({ id: r.id, kind: r.kind })),
    presence: simulatePresence(now, 3),
    weather,
    sun,
    tickSeconds: Math.floor(now / 1000),
  };
}

let tickCounter = 0;

function tick(): void {
  tickCounter += 1;
  const now = simNow();
  // Simulated seconds that elapse per real second of wall time.
  const dt = timeScale();
  const minute = Math.floor(now / 60000);

  const homes = all<{ id: string; lat: number; lon: number }>('SELECT id, lat, lon FROM homes');

  for (const h of homes) {
    const rt = runtimeFor(h.id, h.lat, h.lon);
    refreshContext(rt);

    const devices = listDevices(h.id);
    let totalWatts = 0;
    let anyChanged = false;

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      const result = stepDevice(d.kind, d.state, rt.ctx, d.id.length * 31 + i * 7, dt);
      totalWatts += result.watts;

      if (Object.keys(result.changed).length > 0) {
        saveDeviceState(d.id, result.state);
        anyChanged = true;
        const { pressed, motionDetected, ...clean } = result.changed;
        broadcast({ type: 'telemetry', homeId: h.id, deviceId: d.id, payload: clean, at: now });
        insertTelemetry(d.id, clean);

        if (result.changed.leak === true) {
          insertEvent({ home_id: h.id, device_id: d.id, kind: 'leak', severity: 'critical', title: `Water leak at ${d.name}`, body: 'Main water valve closed automatically.' });
          broadcast({ type: 'event', homeId: h.id, deviceId: d.id, payload: { kind: 'leak', title: `Water leak at ${d.name}` }, at: now });
        }
        if (motionDetected && (d.kind === 'camera' || d.kind === 'doorbell')) {
          insertEvent({ home_id: h.id, device_id: d.id, kind: 'motion', severity: 'info', title: `Motion at ${d.name}`, body: rt.ctx.presence.home ? 'Someone is home.' : 'Unexpected activity while away.' });
        }
        if (pressed) {
          insertEvent({ home_id: h.id, device_id: d.id, kind: 'doorbell', severity: 'info', title: `${d.name} rang`, body: 'Someone is at the front door.' });
        }
      }
    }

    // Presence / sun / weather broadcast every 5 ticks to keep the wire quiet.
    if (tickCounter % 5 === 0) {
      broadcast({
        type: 'weather',
        homeId: h.id,
        payload: {
          weather: rt.ctx.weather,
          sun: rt.ctx.sun,
          localMinutes: localMinutesFor(rt.lon, now),
          daylight: rt.ctx.sun.altitude > 0,
        },
        at: now,
      });
      broadcast({
        type: 'presence',
        homeId: h.id,
        payload: rt.ctx.presence,
        at: now,
      });
    }

    if (minute !== rt.lastEnergyMinute) {
      rt.lastEnergyMinute = minute;
      upsertEnergySample(h.id, minute, Math.round(totalWatts * 10) / 10);
    }

    if (anyChanged || tickCounter % 5 === 0) {
      const devices2 = listDevices(h.id);
      broadcast({
        type: 'energy',
        homeId: h.id,
        payload: { ...powerSummary(devices2), at: now },
        at: now,
      });
    }

    if (tickCounter % 2 === 0) evaluateAutomationsForHome(h);
  }

  if (tickCounter % 600 === 0) pruneTelemetry();
}

/** Simulated seconds to wait before the same automation may fire again. */
const COOLDOWN_SECONDS = 90;

function evaluateAutomationsForHome(h: { id: string }): void {
  const rt = runtimes.get(h.id);
  if (!rt) return;
  const now = simNow();
  const local = localMinutesFor(rt.lon, now);
  const automations = listAutomations(h.id).filter((a) => a.enabled === 1);

  for (const automation of automations) {
    const last = rt.firedCooldowns.get(automation.id) ?? 0;
    if (now - last < COOLDOWN_SECONDS * 1000) continue;

    const { matched, reason } = evaluateTrigger(automation, {
      now,
      localMinutes: local,
      presenceHome: rt.ctx.presence.home,
      weather: rt.ctx.weather,
    });
    if (!matched) continue;
    if (!checkConditions(automation)) continue;

    rt.firedCooldowns.set(automation.id, now);
    bumpAutomationRun(automation.id);
    void runAutomation(automation).then((results) => {
      const ok = results.filter((r) => r.ok);
      const devices: ParsedDevice[] = getDevicesByIds(results.map((r) => r.deviceId));
      for (const d of devices) {
        broadcast({ type: 'state', homeId: h.id, deviceId: d.id, payload: roundState(d.state), at: simNow() });
      }
      const title = ok.length ? `Automation: ${automation.name}` : `Automation skipped: ${automation.name}`;
      const body = ok.length ? ok.map((r) => `${r.name} ${r.message}`).join('; ') : reason;
      insertEvent({ home_id: h.id, kind: 'automation', severity: 'info', title, body });
      broadcast({ type: 'automation', homeId: h.id, payload: { id: automation.id, name: automation.name, body }, at: Date.now() });
    });
  }
}

// ------------------------------------------------------------------- helpers

interface Ctx {
  userId: string;
  homeId: string;
  rate: number;
  currency: string;
}

function ctxFor(req: AuthedRequest, homeId?: string): Ctx | null {
  const userId = req.userId!;
  let home = homeId ?? (req.query.homeId as string | undefined);
  if (!home) {
    const row = get<{ id: string }>('SELECT id FROM homes WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', userId);
    home = row?.id;
  }
  if (!home) return null;
  const homeRow = get<{ id: string; lat: number; lon: number }>('SELECT id, lat, lon FROM homes WHERE id = ? AND user_id = ?', home, userId);
  if (!homeRow) return null;
  runtimeFor(homeRow.id, homeRow.lat, homeRow.lon);
  const user = get<{ currency: string; energy_rate: number }>('SELECT currency, energy_rate FROM users WHERE id = ?', userId)!;
  return { userId, homeId: homeRow.id, rate: user.energy_rate, currency: user.currency };
}

function deviceSummary(d: ParsedDevice) {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    roomId: d.room_id,
    roomName: d.room_id ? (getRoom(d.room_id)?.name ?? null) : null,
    manufacturer: d.manufacturer,
    model: d.model,
    favorite: d.favorite,
    category: CATEGORY[d.kind] ?? 'Other',
    state: roundState(d.state),
    placement: d.placement,
    updatedAt: d.updated_at,
  };
}

// ---------------------------------------------------------------------- API

app.get('/health', (_req, res) => {
  res.json({ ok: true, at: Date.now(), connections: connectedClients(), tick: tickCounter });
});

app.get('/api/demo-credentials', (_req, res) => {
  res.json({ email: 'demo@smartliving.app', password: 'demo1234', name: 'Alex Rivera' });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password || !name) {
    res.status(400).json({ error: 'bad_request', message: 'email, password and name are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'weak_password', message: 'Password must be at least 6 characters' });
    return;
  }
  const existing = get<{ id: string }>('SELECT id FROM users WHERE email = ?', email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'email_taken', message: 'That email is already registered' });
    return;
  }
  const userId = uid('usr_');
  const homeId = uid('home_');
  const now = Date.now();
  db.prepare('INSERT INTO users (id, email, name, password_hash, avatar_hue, currency, energy_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    userId,
    email.toLowerCase(),
    name,
    hashPassword(password),
    Math.floor(Math.random() * 360),
    'USD',
    0.28,
    now,
  );
  db.prepare('INSERT INTO homes (id, user_id, name, lat, lon, sqft, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    homeId,
    userId,
    `${name.split(' ')[0]}'s Home`,
    51.5074,
    -0.1278,
    1200,
    'Europe/London',
    now,
  );
  const rooms = [
    ['Living Room', 'living', '#5B8DEF', { x: 0, z: 0, w: 6, d: 5 }],
    ['Kitchen', 'kitchen', '#2FB89C', { x: 6, z: 0, w: 6, d: 5 }],
    ['Bedroom', 'bedroom', '#9B6BF0', { x: 0, z: 5, w: 3.2, d: 3 }],
    ['Bathroom', 'bathroom', '#48C2E0', { x: 3.2, z: 5, w: 2.8, d: 3 }],
    ['Hallway', 'hallway', '#8892A6', { x: 6, z: 5, w: 3, d: 3 }],
    ['Office', 'office', '#F2A03D', { x: 9, z: 5, w: 3, d: 3 }],
  ] as const;
  for (const [name2, kind, accent, b] of rooms) insertRoom(homeId, name2, kind, accent, b);

  res.status(201).json({ token: issueToken(userId), user: { id: userId, email, name }, homeId });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'bad_request', message: 'email and password are required' });
    return;
  }
  const user = get<{ id: string; email: string; name: string; password_hash: string; avatar_hue: number; currency: string; energy_rate: number }>(
    'SELECT * FROM users WHERE email = ?',
    email.toLowerCase(),
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect' });
    return;
  }
  const home = get<{ id: string }>('SELECT id FROM homes WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', user.id);
  res.json({
    token: issueToken(user.id),
    user: { id: user.id, email: user.email, name: user.name, avatarHue: user.avatar_hue, currency: user.currency, energyRate: user.energy_rate },
    homeId: home?.id ?? null,
  });
});

app.get('/api/me', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const user = db.prepare('SELECT id, email, name, avatar_hue, currency, energy_rate FROM users WHERE id = ?').get(ctx.userId) as {
    id: string;
    email: string;
    name: string;
    avatar_hue: number;
    currency: string;
    energy_rate: number;
  };
  const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(ctx.homeId) as { id: string; name: string; sqft: number; lat: number; lon: number; timezone: string };
  res.json({
    user: { id: user.id, email: user.email, name: user.name, avatarHue: user.avatar_hue, currency: user.currency, energyRate: user.energy_rate },
    home: { id: home.id, name: home.name, sqft: home.sqft, lat: home.lat, lon: home.lon, timezone: home.timezone },
  });
});

app.patch('/api/me', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const { name, currency, energyRate, avatarHue, homeName } = req.body as Record<string, unknown>;
  run(
    `UPDATE users SET
      name = COALESCE(?, name),
      currency = COALESCE(?, currency),
      energy_rate = COALESCE(?, energy_rate),
      avatar_hue = COALESCE(?, avatar_hue)
     WHERE id = ?`,
    typeof name === 'string' ? name : null,
    typeof currency === 'string' ? currency : null,
    typeof energyRate === 'number' ? energyRate : null,
    typeof avatarHue === 'number' ? avatarHue : null,
    ctx.userId,
  );
  if (typeof homeName === 'string' && homeName.trim()) {
    db.prepare('UPDATE homes SET name = ? WHERE id = ?').run(homeName.trim(), ctx.homeId);
  }
  res.json({ ok: true });
});

app.get('/api/home', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(ctx.homeId) as { id: string; name: string; sqft: number; lat: number; lon: number; timezone: string };
  const rt = runtimeFor(home.id, home.lat, home.lon);
  const devices = listDevices(home.id);
  const rooms = listRooms(home.id);
  const byRoom = rooms.map((r) => ({ ...r, deviceCount: devices.filter((d) => d.room_id === r.id).length }));
  const power = powerSummary(devices);

  res.json({
    home: { id: home.id, name: home.name, sqft: home.sqft, lat: home.lat, lon: home.lon, timezone: home.timezone },
    rooms: byRoom,
    presence: rt.ctx.presence,
    weather: rt.ctx.weather,
    sun: rt.ctx.sun,
    localTime: fmtMinutes(localMinutesFor(home.lon, simNow())),
    localMinutes: localMinutesFor(home.lon, simNow()),
    power,
    counts: {
      total: devices.length,
      on: devices.filter((d) => d.state.power === 'on').length,
      favorites: devices.filter((d) => d.favorite).length,
      alerts: devices.filter((d) => d.state.leak || (d.state.battery ?? 100) < 15 || (d.kind === 'lock' && d.state.locked === false)).length,
    },
  });
});

app.get('/api/devices', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const { room, kind, favorite } = req.query as Record<string, string | undefined>;
  let devices = listDevices(ctx.homeId);
  if (room) devices = devices.filter((d) => d.room_id === room);
  if (kind) devices = devices.filter((d) => d.kind === kind);
  if (favorite === '1') devices = devices.filter((d) => d.favorite);
  res.json({ devices: devices.map(deviceSummary) });
});

app.get('/api/devices/:id', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const d = ctx ? getDevice(req.params.id) : null;
  if (!ctx || !d || d.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ device: deviceSummary(d), telemetry: recentTelemetry(d.id, 90) });
});

app.post('/api/devices', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const body = req.body as {
    name?: string;
    kind?: DeviceKind;
    roomId?: string | null;
    manufacturer?: string;
    model?: string;
    placement?: { x: number; y: number; z: number; rotY?: number; scale?: number };
  };
  if (!body.name || !body.kind) {
    res.status(400).json({ error: 'bad_request', message: 'name and kind are required' });
    return;
  }
  const rooms = listRooms(ctx.homeId);
  const room = body.roomId ? rooms.find((r) => r.id === body.roomId) : rooms[0];
  const bounds = room ?? { x: 0, z: 0, w: 3, d: 3 };
  const placement = body.placement ?? {
    x: bounds.x + bounds.w / 2,
    y: 0.4,
    z: bounds.z + bounds.d / 2,
    rotY: 0,
    scale: 1,
  };

  const defaults: Partial<Record<DeviceKind, DeviceState>> = {
    light: { power: 'off', brightness: 70, powerWatts: 0 },
    thermostat: { power: 'on', mode: 'heat', temperature: 21, targetTemperature: 21, humidity: 45, powerWatts: 2.5 },
    lock: { power: 'on', locked: true, battery: 100 },
    camera: { power: 'on', recording: false, powerWatts: 2.6 },
    sensor_motion: { power: 'on', motion: false, battery: 100 },
    sensor_leak: { power: 'on', leak: false, battery: 100 },
    sensor_contact: { power: 'on', open: false, battery: 100 },
    plug: { power: 'off', level: 50, powerWatts: 0.1, energyKwh: 0 },
    speaker: { power: 'off', volume: 30, powerWatts: 0.7 },
    tv: { power: 'off', brightnessBacklight: 60, powerWatts: 0.6 },
    blinds: { power: 'off', position: 0, level: 0 },
    fan: { power: 'off', level: 0 },
    air_quality: { power: 'on', temperature: 21, humidity: 45, co2: 450, pm25: 5, voc: 80, powerWatts: 1.4 },
    doorbell: { power: 'on', battery: 100, powerWatts: 1.1 },
    vacuum: { power: 'off', battery: 100, level: 100 },
    garage: { power: 'off', open: false },
    thermostat_valve: { power: 'on', level: 0, temperature: 20, targetTemperature: 19, powerWatts: 0.2 },
  };

  const id = insertDevice({
    home_id: ctx.homeId,
    room_id: room?.id ?? null,
    name: body.name.trim(),
    kind: body.kind,
    manufacturer: body.manufacturer ?? 'Generic',
    model: body.model ?? 'SL-1',
    state: defaults[body.kind] ?? { power: 'off', powerWatts: 0.1 },
    placement,
  });
  insertEvent({ home_id: ctx.homeId, device_id: id, kind: 'device', severity: 'info', title: `${body.name} added`, body: `Paired successfully.` });
  broadcast({ type: 'event', homeId: ctx.homeId, deviceId: id, payload: { kind: 'device_added', name: body.name }, at: Date.now() });
  const created = getDevice(id)!;
  res.status(201).json({ device: deviceSummary(created) });
});

app.patch('/api/devices/:id', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const d = ctx ? getDevice(req.params.id) : null;
  if (!ctx || !d || d.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const body = req.body as { name?: string; favorite?: boolean; roomId?: string | null; placement?: Record<string, number> };
  patchDevice(d.id, {
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.favorite !== undefined ? { favorite: body.favorite ? 1 : 0 } : {}),
    ...(body.roomId !== undefined ? { room_id: body.roomId } : {}),
    ...(body.placement ? { placement: JSON.stringify(body.placement) } : {}),
  });
  res.json({ device: deviceSummary(getDevice(d.id)!) });
});

app.delete('/api/devices/:id', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const d = ctx ? getDevice(req.params.id) : null;
  if (!ctx || !d || d.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  deleteDevice(d.id);
  broadcast({ type: 'event', homeId: ctx.homeId, payload: { kind: 'device_removed', id: d.id }, at: Date.now() });
  res.json({ ok: true });
});

app.post('/api/devices/:id/command', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const d = ctx ? getDevice(req.params.id) : null;
  if (!ctx || !d || d.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const { command, args } = req.body as { command?: string; args?: Record<string, unknown> };
  if (!command) {
    res.status(400).json({ error: 'bad_request', message: 'command is required' });
    return;
  }
  const results = executeCommand(ctx.homeId, command, args ?? {}, { deviceId: d.id });
  const updated = getDevice(d.id)!;
  broadcast({ type: 'state', homeId: ctx.homeId, deviceId: d.id, payload: roundState(updated.state), at: simNow() });
  insertEvent({ home_id: ctx.homeId, device_id: d.id, kind: 'control', severity: 'info', title: `${d.name} ${results[0]?.message ?? command}`, body: 'Changed from the app.' });
  res.json({ results, device: deviceSummary(updated) });
});

app.post('/api/rooms', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const { name, kind, accent } = req.body as { name?: string; kind?: string; accent?: string };
  if (!name) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const rooms = listRooms(ctx.homeId);
  const maxX = Math.max(0, ...rooms.map((r) => r.x + r.w));
  const id = insertRoom(ctx.homeId, name.trim(), kind ?? 'other', accent ?? '#5B8DEF', { x: maxX + 0.5, z: 0, w: 3, d: 3 });
  res.status(201).json({ room: getRoom(id) });
});

app.get('/api/scenes', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  res.json({ scenes: listScenes(ctx.homeId) });
});

app.post('/api/scenes/:id/run', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const scene = ctx ? getScene(req.params.id) : null;
  if (!ctx || !scene || scene.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const actions = scene.actions as Array<{ deviceId?: string; deviceKind?: string; command: string; args?: Record<string, unknown> }>;
  const results: CommandResult[] = [];
  for (const a of actions) {
    results.push(...executeCommand(ctx.homeId, a.command, a.args ?? {}, { deviceId: a.deviceId, deviceKind: a.deviceKind }));
  }
  bumpSceneRun(scene.id);
  for (const d of listDevices(ctx.homeId)) {
    broadcast({ type: 'state', homeId: ctx.homeId, deviceId: d.id, payload: roundState(d.state), at: simNow() });
  }
  insertEvent({ home_id: ctx.homeId, kind: 'scene', severity: 'info', title: `Scene: ${scene.name}`, body: `${results.length} device update${results.length === 1 ? '' : 's'}.` });
  res.json({ ok: true, results });
});

app.get('/api/automations', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const rows = listAutomations(ctx.homeId);
  res.json({
    automations: rows.map((a) => ({
      ...a,
      enabled: a.enabled === 1,
      trigger: JSON.parse(a.trigger),
      conditions: JSON.parse(a.conditions),
      actions: JSON.parse(a.actions),
    })),
  });
});

app.post('/api/automations', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const body = req.body as {
    name?: string;
    description?: string;
    trigger?: unknown;
    conditions?: unknown[];
    actions?: Action[];
    enabled?: boolean;
  };
  if (!body.name || !body.trigger || !body.actions || body.actions.length === 0) {
    res.status(400).json({ error: 'bad_request', message: 'name, trigger and actions are required' });
    return;
  }
  const id = uid('auto_');
  db.prepare('INSERT INTO automations (id, home_id, name, description, enabled, trigger, conditions, actions, run_count, last_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)').run(
    id,
    ctx.homeId,
    body.name.trim(),
    body.description ?? null,
    body.enabled === false ? 0 : 1,
    JSON.stringify(body.trigger),
    JSON.stringify(body.conditions ?? []),
    JSON.stringify(body.actions),
    Date.now(),
  );
  res.status(201).json({ automation: getAutomation(id) });
});

app.patch('/api/automations/:id', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const a = ctx ? getAutomation(req.params.id) : null;
  if (!ctx || !a || a.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const body = req.body as { enabled?: boolean; name?: string; description?: string; trigger?: unknown; conditions?: unknown[]; actions?: Action[] };
  db.prepare(
    `UPDATE automations SET
      enabled = COALESCE(?, enabled),
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      trigger = COALESCE(?, trigger),
      conditions = COALESCE(?, conditions),
      actions = COALESCE(?, actions)
     WHERE id = ?`,
  ).run(
    body.enabled === undefined ? null : body.enabled ? 1 : 0,
    body.name ?? null,
    body.description ?? null,
    body.trigger ? JSON.stringify(body.trigger) : null,
    body.conditions ? JSON.stringify(body.conditions) : null,
    body.actions ? JSON.stringify(body.actions) : null,
    a.id,
  );
  res.json({ automation: getAutomation(a.id) });
});

app.delete('/api/automations/:id', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const a = ctx ? getAutomation(req.params.id) : null;
  if (!ctx || !a || a.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare('DELETE FROM automations WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

app.post('/api/automations/:id/run', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  const a = ctx ? getAutomation(req.params.id) : null;
  if (!ctx || !a || a.home_id !== ctx.homeId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  void runAutomation(a).then((results) => {
    for (const d of listDevices(ctx.homeId)) {
      broadcast({ type: 'state', homeId: ctx.homeId, deviceId: d.id, payload: roundState(d.state), at: simNow() });
    }
    res.json({ ok: true, results });
  });
});

app.get('/api/energy', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  res.json(buildEnergyReport(ctx.homeId, ctx.rate, ctx.currency));
});

app.get('/api/insights', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const devices = listDevices(ctx.homeId);
  const report = buildEnergyReport(ctx.homeId, ctx.rate, ctx.currency);
  res.json({ insights: buildInsights(ctx.homeId, devices, report, ctx.currency) });
});

app.get('/api/events', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const devices = new Map(listDevices(ctx.homeId).map((d) => [d.id, d.name]));
  res.json({
    events: listEvents(ctx.homeId, 80).map((e) => ({ ...e, deviceName: e.device_id ? (devices.get(e.device_id) ?? null) : null })),
  });
});

app.get('/api/ai/history', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const rows = aiHistory(ctx.homeId, 40).reverse();
  res.json({
    messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, meta: r.meta ? JSON.parse(r.meta) : null, at: r.at })),
    suggestions: SUGGESTIONS,
  });
});

app.get('/api/ai/suggestions', (_req, res) => {
  res.json({ suggestions: SUGGESTIONS });
});

app.get('/api/sim', requireAuth, (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const home = get<{ lat: number; lon: number }>('SELECT lat, lon FROM homes WHERE id = ?', ctx.homeId)!;
  const rt = runtimeFor(ctx.homeId, home.lat, home.lon);
  res.json({
    scale: timeScale(),
    simNow: simNow(),
    realNow: Date.now(),
    localTime: fmtMinutes(localMinutesFor(home.lon, simNow())),
    sun: rt.ctx.sun,
    presence: rt.ctx.presence,
    weather: rt.ctx.weather,
  });
});

app.post('/api/sim/scale', requireAuth, (req: AuthedRequest, res) => {
  const { scale } = req.body as { scale?: number };
  if (typeof scale !== 'number') {
    res.status(400).json({ error: 'bad_request', message: 'scale must be a number' });
    return;
  }
  res.json({ scale: setTimeScale(scale) });
});

app.post('/api/ai/chat', requireAuth, async (req: AuthedRequest, res) => {
  const ctx = ctxFor(req);
  if (!ctx) {
    res.status(404).json({ error: 'no_home' });
    return;
  }
  const { message } = req.body as { message?: string };
  if (!message || !message.trim()) {
    res.status(400).json({ error: 'bad_request', message: 'message is required' });
    return;
  }

  const devices = listDevices(ctx.homeId);
  const rooms = listRooms(ctx.homeId);
  const scenes = listScenes(ctx.homeId);
  const rt = runtimeFor(ctx.homeId, (db.prepare('SELECT lat FROM homes WHERE id = ?').get(ctx.homeId) as { lat: number }).lat, 0);
  const report = buildEnergyReport(ctx.homeId, ctx.rate, ctx.currency);
  const tempDevices = devices.filter((d) => d.state.temperature !== undefined);

  const engineCtx: EngineContext = {
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, kind: d.kind, room_id: d.room_id, roomName: d.room_id ? (getRoom(d.room_id)?.name ?? null) : null, power: d.state.power })),
    scenes: scenes.map((s) => ({ id: s.id, name: s.name })),
    energyTodayKwh: report.today.kwh,
    energyCostToday: report.today.cost,
    totalDevicesOn: devices.filter((d) => d.state.power === 'on').length,
    securityIssues: buildInsights(ctx.homeId, devices, report, ctx.currency)
      .filter((i) => i.severity === 'critical' || i.severity === 'warning')
      .map((i) => i.title),
    presenceHome: rt.ctx.presence.home,
    localTime: fmtMinutes(localMinutesFor(rt.lon, simNow())),
    outdoorTemp: rt.ctx.weather.outdoorTemp,
    weatherCondition: rt.ctx.weather.condition,
    indoorAvgTemp: tempDevices.length ? tempDevices.reduce((a, d) => a + (d.state.temperature ?? 21), 0) / tempDevices.length : 21,
    currency: ctx.currency,
  };

  const localPlan = parseIntent(message, engineCtx);
  const plan = await planViaLlm(message, engineCtx, localPlan);

  insertAiMessage(ctx.homeId, 'user', message.trim());

  const sym = currencySymbol(ctx.currency);
  let reply = plan.reply;
  let meta: Record<string, unknown> = { intent: plan.intent, confidence: Math.round(plan.confidence * 100) / 100, entities: plan.entities };
  let results: CommandResult[] = [];

  try {
    switch (plan.intent) {
      case 'scene.activate': {
        const sceneId = plan.args?.sceneId as string;
        const scene = getScene(sceneId) ?? scenes.find((s) => s.name.toLowerCase().includes((String(sceneId)).toLowerCase()));
        if (scene && scene.home_id === ctx.homeId) {
          const actions = scene.actions as Array<{ deviceId?: string; deviceKind?: string; command: string; args?: Record<string, unknown> }>;
          for (const a of actions) results.push(...executeCommand(ctx.homeId, a.command, a.args ?? {}, { deviceId: a.deviceId, deviceKind: a.deviceKind }));
          bumpSceneRun(scene.id);
          reply = `${scene.name} is active. ${results.length} devices updated.`;
          meta.sceneId = scene.id;
        } else {
          reply = `I could not find a scene called "${sceneId}". Available: ${scenes.map((s) => s.name).join(', ')}.`;
        }
        break;
      }
      case 'device.turn_on':
      case 'device.turn_off':
      case 'device.toggle':
      case 'device.set_brightness':
      case 'device.set_volume':
      case 'device.set_temperature':
      case 'device.set_level':
      case 'device.lock':
      case 'device.unlock':
      case 'device.set_position':
      case 'media.play':
      case 'media.pause': {
        if (plan.command) {
          const target = plan.target?.deviceId ? { deviceId: plan.target.deviceId } : { deviceKind: plan.target?.deviceKind };
          results = executeCommand(ctx.homeId, plan.command, plan.args ?? {}, target);
          reply = summariseResults(results);
          insertEvent({
            home_id: ctx.homeId,
            kind: 'ai',
            severity: 'info',
            title: `AI: ${message.trim()}`,
            body: results.map((r) => `${r.name} ${r.message}`).join('; '),
          });
        }
        break;
      }
      case 'energy.report': {
        reply = `Today you have used ${report.today.kwh} kWh (${sym}${report.today.cost}). That is ${Math.abs(Math.round(report.today.vsYesterdayPct))}% ${report.today.vsYesterdayPct >= 0 ? 'more' : 'less'} than yesterday. Current draw is ${report.today.avgWatts} W and your biggest category is ${report.byCategory[0]?.category ?? 'n/a'} at ${report.byCategory[0]?.pct ?? 0}% of the week. Projected month total: ${report.month.projectedKwh} kWh (${sym}${report.month.projectedCost}).`;
        meta.energy = report.today;
        break;
      }
      case 'energy.explain': {
        const drivers = buildInsights(ctx.homeId, devices, report, ctx.currency).filter((i) => i.savingsKwh);
        const lines = drivers.length
          ? drivers.map((d) => `• ${d.title} — ${d.body}`).join('\n')
          : '• Nothing unusual. Your usage is tracking within normal range.';
        reply = `Here is what is driving your bill:\n${lines}\n\nToday: ${report.today.kwh} kWh (${sym}${report.today.cost}). Week over week you are ${Math.round(report.weekOverWeekPct)}%.`;
        meta.insights = drivers;
        break;
      }
      case 'security.status': {
        const locks = devices.filter((d) => d.kind === 'lock');
        const unlocked = locks.filter((d) => d.state.locked === false);
        const cameras = devices.filter((d) => d.kind === 'camera' || d.kind === 'doorbell');
        const recording = cameras.filter((d) => d.state.recording);
        const leaks = devices.filter((d) => d.state.leak);
        const motion = devices.filter((d) => d.state.motion);
        reply = leaks.length
          ? `Urgent: water leak detected at ${leaks.map((d) => d.name).join(', ')}. The main valve is closed.`
          : unlocked.length
            ? `${unlocked.length} door${unlocked.length > 1 ? 's are' : ' is'} unlocked (${unlocked.map((d) => d.name).join(', ')}). ${cameras.length - recording.length} of ${cameras.length} cameras are idle.`
            : `All ${locks.length} doors are locked, no leaks detected, and ${recording.length} of ${cameras.length} cameras are recording. ${motion.length ? `Motion seen at ${motion.map((d) => d.name).join(', ')}.` : 'No unusual motion.'}`;
        meta.security = { locks: locks.length, unlocked: unlocked.length, cameras: cameras.length, recording: recording.length };
        break;
      }
      case 'home.what_is_on': {
        const on = devices.filter((d) => d.state.power === 'on');
        const notable = on.filter((d) => (d.state.powerWatts ?? 0) > 8).sort((a, b) => (b.state.powerWatts ?? 0) - (a.state.powerWatts ?? 0));
        reply = on.length
          ? `${on.length} of ${devices.length} devices are on. Biggest loads: ${notable.slice(0, 4).map((d) => `${d.name} (${Math.round(d.state.powerWatts ?? 0)} W)`).join(', ')}. Total draw ${Math.round(on.reduce((a, d) => a + (d.state.powerWatts ?? 0), 0))} W. Indoors it is ${engineCtx.indoorAvgTemp.toFixed(1)}°C and outside ${rt.ctx.weather.outdoorTemp}°C (${rt.ctx.weather.condition}).`
          : `Everything is off. The house is using only standby power right now.`;
        break;
      }
      case 'insights.summary': {
        const insights = buildInsights(ctx.homeId, devices, report, ctx.currency);
        reply = insights.length
          ? `${insights.length} thing${insights.length > 1 ? 's' : ''} worth your attention:\n${insights.map((i, idx) => `${idx + 1}. ${i.title} — ${i.body}`).join('\n')}`
          : 'Everything looks healthy. No anomalies, no wasted energy, and your security posture is good.';
        meta.insights = insights;
        break;
      }
      case 'automation.create': {
        const draft = draftAutomation(message, devices, rooms);
        if (draft) {
          db.prepare('INSERT INTO automations (id, home_id, name, description, enabled, trigger, conditions, actions, run_count, last_run_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, NULL, ?)').run(
            uid('auto_'),
            ctx.homeId,
            draft.name,
            `Created from the assistant: "${message.trim()}"`,
            JSON.stringify(draft.trigger),
            '[]',
            JSON.stringify(draft.actions),
            Date.now(),
          );
          reply = `I created the automation "${draft.name}". It will ${draft.explain}. You can edit it in the Automations tab.`;
          meta.draft = draft;
        } else {
          reply = 'I can create automations like "turn on the porch light when motion is detected" or "set the thermostat to 19 when everyone leaves". Try one of those.';
        }
        break;
      }
      case 'help': {
        reply = `I can control devices, run scenes, and explain your data. Try:\n• "Turn on the living room lights"\n• "Set the thermostat to 22"\n• "Lock the doors"\n• "Movie night"\n• "How much energy am I using?"\n• "Why is my bill high?"\n• "Is my home secure?"\n• "What is on right now?"`;
        break;
      }
      default:
        break;
    }
  } catch (error) {
    reply = `Something went wrong while applying that: ${(error as Error).message}`;
  }

  insertAiMessage(ctx.homeId, 'assistant', reply, meta);
  broadcast({ type: 'event', homeId: ctx.homeId, payload: { kind: 'ai', title: message.trim() }, at: Date.now() });

  res.json({ reply, meta, plan: { intent: plan.intent, confidence: plan.confidence, entities: plan.entities }, suggestions: SUGGESTIONS });
});

function draftAutomation(text: string, devices: ParsedDevice[], rooms: ReturnType<typeof listRooms>) {
  const lower = text.toLowerCase();
  const lightIds = devices.filter((d) => d.kind === 'light').map((d) => d.id);
  const motion = devices.find((d) => d.kind === 'sensor_motion');
  const lockIds = devices.filter((d) => d.kind === 'lock').map((d) => d.id);
  const tempMatch = lower.match(/(\d{1,2})\s*(?:degrees?|deg|celsius)/);
  const timeMatch = lower.match(/\b(?:at|from)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);

  if (lower.includes('motion') && motion && lightIds.length) {
    return {
      name: 'Light on motion',
      trigger: { kind: 'device_metric', deviceId: motion.id, metric: 'motion', op: 'eq', value: true },
      actions: [{ deviceKind: 'light', command: 'turnOn' }],
      explain: 'turn every light on as soon as motion is detected',
    };
  }
  if (lower.includes('sunset') && lightIds.length) {
    return {
      name: 'Lights at sunset',
      trigger: { kind: 'sun_event', op: 'eq', value: 18 },
      actions: [{ deviceKind: 'light', command: 'turnOn' }],
      explain: 'turn on the lights at sunset',
    };
  }
  if (lower.includes('sunrise')) {
    return {
      name: 'Good morning at sunrise',
      trigger: { kind: 'sun_event', op: 'eq', value: 6 },
      actions: [{ deviceKind: 'light', command: 'setBrightness', args: { value: 40 } }],
      explain: 'gently raise the lights at sunrise',
    };
  }
  if ((lower.includes('lock') || lower.includes('secure')) && lockIds.length && (lower.includes('night') || lower.includes('bed'))) {
    return {
      name: 'Lock up at night',
      trigger: { kind: 'time_of_day', op: 'eq', value: 23 * 60 },
      actions: [{ deviceKind: 'lock', command: 'lock' }],
      explain: 'lock every door at 23:00',
    };
  }
  if (timeMatch && lightIds.length) {
    let hour = Number(timeMatch[1]) % 12;
    if (timeMatch[3] === 'pm') hour += 12;
    if (timeMatch[3] === 'am' && Number(timeMatch[1]) === 12) hour = 0;
    const minutes = hour * 60 + Number(timeMatch[2] ?? 0);
    const room = rooms.find((r) => lower.includes(r.name.toLowerCase()));
    return {
      name: `Lights at ${String(hour).padStart(2, '0')}:${timeMatch[2] ?? '00'}`,
      trigger: { kind: 'time_of_day', op: 'eq', value: minutes },
      actions: [{ deviceKind: 'light', command: 'turnOn' }],
      explain: `turn on the ${room ? `${room.name} ` : ''}lights every day at ${String(hour).padStart(2, '0')}:${timeMatch[2] ?? '00'}`,
    };
  }
  if (tempMatch) {
    const target = Math.max(5, Math.min(32, Number(tempMatch[1])));
    return {
      name: `Thermostat to ${target}°C`,
      trigger: { kind: 'presence', op: 'eq', value: 'away' },
      actions: [{ deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: target } }],
      explain: `drop the thermostat to ${target}°C whenever the house is empty`,
    };
  }
  return null;
}

// Client crash reports. The mobile app forwards its global JS errors here so a
// failure on a physical device (which we cannot attach a console to) is visible
// in the server log. Unauthenticated by design: it must work before login.
app.post('/api/client-log', (req, res) => {
  const { level, message, stack, at } = (req.body ?? {}) as Record<string, unknown>;
  console.log(`\n--- CLIENT ${String(level ?? 'error').toUpperCase()} ---`);
  console.log(`  ${String(message ?? '(no message)').slice(0, 2000)}`);
  if (stack) console.log(String(stack).split('\n').slice(0, 12).join('\n'));
  console.log(`  at ${String(at ?? 'unknown')}\n`);
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `${req.method} ${req.path}` });
});

// -------------------------------------------------------------------- boot

const server = createServer(app);
attachRealtime(server);

if (!isSeeded()) {
  const s = seed();
  console.log(`[seed] created demo home ${s.homeId} (${s.email} / demo1234)`);
}

setInterval(() => {
  try {
    tick();
  } catch (error) {
    console.error('[tick]', error);
  }
}, 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Living API listening on http://0.0.0.0:${PORT}`);
  console.log(`Realtime stream: ws://0.0.0.0:${PORT}/realtime?token=<jwt>&homeId=<homeId>`);
});

export { app, server };