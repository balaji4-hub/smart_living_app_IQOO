import { randomUUID } from 'node:crypto';
import { all, get, jsonGet, run } from './db.ts';
import type { Automation, DeviceKind, DeviceRow, DeviceState, ParsedDevice } from './types.ts';
import { simNow } from './sim/clock.ts';

export function uid(prefix = ''): string {
  return prefix + randomUUID();
}

export function nowMs(): number {
  return simNow();
}

/**
 * Values are stored at full precision so small per-tick deltas accumulate
 * instead of being lost to rounding, then rounded only for the wire.
 */
const PRECISION: Record<string, number> = {
  temperature: 1,
  targetTemperature: 1,
  humidity: 0,
  co2: 0,
  voc: 0,
  pm25: 1,
  battery: 0,
  powerWatts: 1,
  energyKwh: 3,
  level: 0,
  position: 0,
  brightness: 0,
  brightnessBacklight: 0,
  volume: 0,
};

export function roundState(state: DeviceState): DeviceState {
  const out = { ...state } as Record<string, unknown>;
  for (const [key, digits] of Object.entries(PRECISION)) {
    const v = out[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = Number(v.toFixed(digits));
    }
  }
  return out as unknown as DeviceState;
}

export function mapDevice(row: DeviceRow): ParsedDevice {
  return {
    ...row,
    favorite: row.favorite === 1,
    state: jsonGet<DeviceState>(row.state, { power: 'off' }),
    placement: jsonGet(row.placement, { x: 0, y: 0, z: 0 }),
  };
}

export function listDevices(homeId: string): ParsedDevice[] {
  return all<DeviceRow>('SELECT * FROM devices WHERE home_id = ? ORDER BY created_at ASC', homeId).map(mapDevice);
}

export function getDevice(id: string): ParsedDevice | null {
  const row = get<DeviceRow>('SELECT * FROM devices WHERE id = ?', id);
  return row ? mapDevice(row) : null;
}

export function getDevicesByIds(ids: string[]): ParsedDevice[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return all<DeviceRow>(`SELECT * FROM devices WHERE id IN (${placeholders})`, ...ids).map(mapDevice);
}

export function saveDeviceState(id: string, state: DeviceState): void {
  run('UPDATE devices SET state = ?, updated_at = ? WHERE id = ?', JSON.stringify(state), nowMs(), id);
}

export function patchDevice(id: string, fields: Partial<{ name: string; favorite: number; room_id: string | null; placement: string }>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (fields as Record<string, string | number | null>)[k]);
  run(`UPDATE devices SET ${setSql}, updated_at = ? WHERE id = ?`, ...values, nowMs(), id);
}

export function insertDevice(input: {
  home_id: string;
  room_id: string | null;
  name: string;
  kind: DeviceKind;
  manufacturer: string;
  model: string;
  favorite?: number;
  state: DeviceState;
  placement: { x: number; y: number; z: number; rotY?: number; scale?: number };
}): string {
  const id = uid('dev_');
  const ts = nowMs();
  run(
    `INSERT INTO devices (id, home_id, room_id, name, kind, manufacturer, model, favorite, state, placement, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.home_id,
    input.room_id,
    input.name,
    input.kind,
    input.manufacturer,
    input.model,
    input.favorite ?? 0,
    JSON.stringify(input.state),
    JSON.stringify(input.placement),
    ts,
    ts,
  );
  return id;
}

export function deleteDevice(id: string): void {
  run('DELETE FROM devices WHERE id = ?', id);
}

export interface RoomRow {
  id: string;
  home_id: string;
  name: string;
  kind: string;
  position: number;
  accent: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export function listRooms(homeId: string): RoomRow[] {
  return all<RoomRow>('SELECT * FROM rooms WHERE home_id = ? ORDER BY position ASC', homeId);
}

export function getRoom(id: string): RoomRow | undefined {
  return get<RoomRow>('SELECT * FROM rooms WHERE id = ?', id);
}

export function insertRoom(
  homeId: string,
  name: string,
  kind: string,
  accent: string,
  bounds: { x: number; z: number; w: number; d: number },
): string {
  const id = uid('room_');
  const max = get<{ m: number }>('SELECT COALESCE(MAX(position), 0) AS m FROM rooms WHERE home_id = ?', homeId)!;
  run(
    'INSERT INTO rooms (id, home_id, name, kind, position, accent, x, z, w, d) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    homeId,
    name,
    kind,
    max.m + 1,
    accent,
    bounds.x,
    bounds.z,
    bounds.w,
    bounds.d,
  );
  return id;
}

export interface SceneRow {
  id: string;
  home_id: string;
  name: string;
  icon: string;
  accent: string;
  actions: string;
  run_count: number;
  last_run_at: number | null;
  created_at: number;
}

export type ParsedScene = Omit<SceneRow, 'actions'> & { actions: Array<Record<string, unknown>> };

export function listScenes(homeId: string): ParsedScene[] {
  return all<SceneRow>('SELECT * FROM scenes WHERE home_id = ? ORDER BY created_at ASC', homeId).map((r) => ({
    ...r,
    actions: jsonGet<Array<Record<string, unknown>>>(r.actions, []),
  }));
}

export function getScene(id: string): ParsedScene | null {
  const row = get<SceneRow>('SELECT * FROM scenes WHERE id = ?', id);
  return row ? { ...row, actions: jsonGet<Array<Record<string, unknown>>>(row.actions, []) } : null;
}

export function bumpSceneRun(id: string): void {
  run('UPDATE scenes SET run_count = run_count + 1, last_run_at = ? WHERE id = ?', nowMs(), id);
}

/** SQLite has no boolean type, so normalise the 0/1 column on the way out. */
function normalizeAutomation(row: Automation): Automation {
  return { ...row, enabled: Boolean((row as unknown as { enabled: unknown }).enabled) };
}

export function listAutomations(homeId: string): Automation[] {
  return all<Automation>('SELECT * FROM automations WHERE home_id = ? ORDER BY created_at ASC', homeId).map(normalizeAutomation);
}

export function getAutomation(id: string): Automation | null {
  const row = get<Automation>('SELECT * FROM automations WHERE id = ?', id);
  return row ? normalizeAutomation(row) : null;
}

export function bumpAutomationRun(id: string): void {
  run('UPDATE automations SET run_count = run_count + 1, last_run_at = ? WHERE id = ?', nowMs(), id);
}

export interface EventRow {
  id: string;
  home_id: string;
  device_id: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  at: number;
  acknowledged: number;
}

export function insertEvent(input: {
  home_id: string;
  device_id?: string | null;
  kind: string;
  severity?: string;
  title: string;
  body?: string;
}): string {
  const id = uid('evt_');
  run(
    'INSERT INTO events (id, home_id, device_id, kind, severity, title, body, at, acknowledged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
    id,
    input.home_id,
    input.device_id ?? null,
    input.kind,
    input.severity ?? 'info',
    input.title,
    input.body ?? null,
    nowMs(),
  );
  return id;
}

export function listEvents(homeId: string, limit = 60): EventRow[] {
  return all<EventRow>('SELECT * FROM events WHERE home_id = ? ORDER BY at DESC LIMIT ?', homeId, limit);
}

export function recentTelemetry(deviceId: string, limit = 120) {
  const rows = all<{ at: number; payload: string }>(
    'SELECT at, payload FROM telemetry WHERE device_id = ? ORDER BY at DESC LIMIT ?',
    deviceId,
    limit,
  );
  return rows.reverse().map((r) => ({ at: r.at, ...jsonGet<Record<string, number>>(r.payload, {}) }));
}

export function insertTelemetry(deviceId: string, payload: Record<string, unknown>): void {
  run('INSERT INTO telemetry (device_id, at, payload) VALUES (?, ?, ?)', deviceId, nowMs(), JSON.stringify(payload));
}

export function pruneTelemetry(): void {
  run('DELETE FROM telemetry WHERE at < ?', nowMs() - 1000 * 60 * 60 * 24 * 30);
  run('DELETE FROM energy_samples WHERE minute < ?', nowMs() / 60000 - 60 * 24 * 30);
}

export function upsertEnergySample(homeId: string, minute: number, watts: number): void {
  run(
    `INSERT INTO energy_samples (home_id, minute, watts) VALUES (?, ?, ?)
     ON CONFLICT(home_id, minute) DO UPDATE SET watts = excluded.watts`,
    homeId,
    minute,
    watts,
  );
}

export function energyRange(homeId: string, sinceMinute: number): Array<{ minute: number; watts: number }> {
  return all<{ minute: number; watts: number }>(
    'SELECT minute, watts FROM energy_samples WHERE home_id = ? AND minute >= ? ORDER BY minute ASC',
    homeId,
    sinceMinute,
  );
}

export function aiHistory(homeId: string, limit = 50) {
  return all<{ id: string; role: string; content: string; meta: string | null; at: number }>(
    'SELECT id, role, content, meta, at FROM ai_messages WHERE home_id = ? ORDER BY at DESC LIMIT ?',
    homeId,
    limit,
  );
}

export function insertAiMessage(homeId: string, role: string, content: string, meta?: unknown): void {
  run(
    'INSERT INTO ai_messages (id, home_id, role, content, meta, at) VALUES (?, ?, ?, ?, ?, ?)',
    uid('msg_'),
    homeId,
    role,
    content,
    meta === undefined ? null : JSON.stringify(meta),
    nowMs(),
  );
}