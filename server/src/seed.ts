import { db } from './db.ts';
import { hashPassword } from './auth.ts';
import { insertRoom, insertDevice, uid, insertEvent } from './store.ts';
import type { DeviceKind, DeviceState } from './types.ts';
import { simulatePresence, simulateWeather, sunPosition } from './sim/physics.ts';
import { simNow } from './sim/clock.ts';

interface RoomSpec {
  name: string;
  kind: string;
  accent: string;
  bounds: { x: number; z: number; w: number; d: number };
}

/** Floor plan in metres. Origin is the front-left corner of the house. */
const ROOMS: RoomSpec[] = [
  { name: 'Living Room', kind: 'living', accent: '#5B8DEF', bounds: { x: 0, z: 0, w: 6, d: 5 } },
  { name: 'Kitchen', kind: 'kitchen', accent: '#2FB89C', bounds: { x: 6, z: 0, w: 6, d: 5 } },
  { name: 'Bedroom', kind: 'bedroom', accent: '#9B6BF0', bounds: { x: 0, z: 5, w: 3.2, d: 3 } },
  { name: 'Bathroom', kind: 'bathroom', accent: '#48C2E0', bounds: { x: 3.2, z: 5, w: 2.8, d: 3 } },
  { name: 'Hallway', kind: 'hallway', accent: '#8892A6', bounds: { x: 6, z: 5, w: 3, d: 3 } },
  { name: 'Office', kind: 'office', accent: '#F2A03D', bounds: { x: 9, z: 5, w: 3, d: 3 } },
  { name: 'Garage', kind: 'garage', accent: '#6B7280', bounds: { x: 1, z: 9.4, w: 5, d: 3.4 } },
];

interface DeviceSpec {
  name: string;
  kind: DeviceKind;
  room: string;
  manufacturer: string;
  model: string;
  favorite?: boolean;
  placement: { x: number; y: number; z: number; rotY?: number; scale?: number };
  state: DeviceState;
}

const DEVICES: DeviceSpec[] = [
  // Living room
  { name: 'Ceiling Light', kind: 'light', room: 'Living Room', manufacturer: 'Philips Hue', model: 'White Ambiance', favorite: true, placement: { x: 3, y: 2.7, z: 2.5 }, state: { power: 'on', brightness: 72, powerWatts: 8.9 } },
  { name: 'Floor Lamp', kind: 'light', room: 'Living Room', manufacturer: 'IKEA', model: 'TRÅDFRI', placement: { x: 0.9, y: 1.1, z: 0.9 }, state: { power: 'off', brightness: 40, powerWatts: 0 } },
  { name: 'TV', kind: 'tv', room: 'Living Room', manufacturer: 'Sony', model: 'Bravia XR', favorite: true, placement: { x: 3, y: 1.1, z: 4.7, rotY: Math.PI }, state: { power: 'on', brightnessBacklight: 45, playing: 'Nature Documentary', powerWatts: 48 } },
  { name: 'Soundbar', kind: 'speaker', room: 'Living Room', manufacturer: 'Sonos', model: 'Arc', placement: { x: 3, y: 0.55, z: 4.5, rotY: Math.PI }, state: { power: 'on', volume: 28, playing: 'Nature Documentary', powerWatts: 6.4 } },
  { name: 'Blinds', kind: 'blinds', room: 'Living Room', manufacturer: 'IKEA', model: 'FYRTUR', placement: { x: 0.15, y: 1.9, z: 2.5, rotY: Math.PI / 2 }, state: { power: 'off', position: 35, level: 35, powerWatts: 0 } },
  { name: 'Motion Sensor', kind: 'sensor_motion', room: 'Living Room', manufacturer: 'Aqara', model: 'RTCGQ11LM', placement: { x: 5.85, y: 2.3, z: 1.2, rotY: -Math.PI / 2 }, state: { power: 'on', motion: false, battery: 78, powerWatts: 0.04 } },
  { name: 'Air Monitor', kind: 'air_quality', room: 'Living Room', manufacturer: 'Netatmo', model: 'Healthy Home', favorite: true, placement: { x: 1.1, y: 1.25, z: 2.1 }, state: { power: 'on', temperature: 21.8, humidity: 44, co2: 612, pm25: 7.2, voc: 118, powerWatts: 1.4 } },

  // Kitchen
  { name: 'Kitchen Light', kind: 'light', room: 'Kitchen', manufacturer: 'Philips Hue', model: 'White', placement: { x: 9, y: 2.7, z: 2.5 }, state: { power: 'on', brightness: 88, powerWatts: 10.7 } },
  { name: 'Smart Fridge', kind: 'plug', room: 'Kitchen', manufacturer: 'Bosch', model: 'KGN39', placement: { x: 11.4, y: 0.9, z: 0.7, rotY: -Math.PI / 2 }, state: { power: 'on', level: 62, powerWatts: 96, energyKwh: 412.7 } },
  { name: 'Dishwasher', kind: 'plug', room: 'Kitchen', manufacturer: 'Bosch', model: 'Serie 6', placement: { x: 11.4, y: 0.45, z: 1.9, rotY: -Math.PI / 2 }, state: { power: 'off', level: 0, powerWatts: 0.1, energyKwh: 186.2 } },
  { name: 'Leak Sensor', kind: 'sensor_leak', room: 'Kitchen', manufacturer: 'Aqara', model: 'SJCGQ11LM', placement: { x: 6.2, y: 0.15, z: 4.7 }, state: { power: 'on', leak: false, battery: 91, powerWatts: 0.03 } },
  { name: 'Kitchen Speaker', kind: 'speaker', room: 'Kitchen', manufacturer: 'Google', model: 'Nest Mini', placement: { x: 7.2, y: 1.3, z: 0.6 }, state: { power: 'on', volume: 22, playing: 'Coffeehouse Radio', powerWatts: 3.1 } },

  // Bedroom
  { name: 'Bedside Lamp', kind: 'light', room: 'Bedroom', manufacturer: 'IKEA', model: 'TRÅDFRI', favorite: true, placement: { x: 0.6, y: 0.75, z: 6.1 }, state: { power: 'off', brightness: 25, powerWatts: 0 } },
  { name: 'Ceiling Fan', kind: 'fan', room: 'Bedroom', manufacturer: 'Haiku', model: 'L Series', placement: { x: 1.6, y: 2.5, z: 6.5 }, state: { power: 'on', level: 32, temperature: 21.4, powerWatts: 10.3 } },
  { name: 'Bedroom Blinds', kind: 'blinds', room: 'Bedroom', manufacturer: 'IKEA', model: 'FYRTUR', placement: { x: 1.6, y: 1.9, z: 8.0, rotY: Math.PI }, state: { power: 'off', position: 0, level: 0, powerWatts: 0 } },
  { name: 'Thermostat', kind: 'thermostat', room: 'Bedroom', manufacturer: 'Nest', model: 'Learning v3', favorite: true, placement: { x: 3.05, y: 1.45, z: 7.4, rotY: -Math.PI / 2 }, state: { power: 'on', mode: 'heat', temperature: 21.2, targetTemperature: 21, humidity: 42, powerWatts: 1420 } },

  // Bathroom
  { name: 'Bathroom Light', kind: 'light', room: 'Bathroom', manufacturer: 'Philips Hue', model: 'White', placement: { x: 4.6, y: 2.4, z: 6.5 }, state: { power: 'off', brightness: 60, powerWatts: 0 } },
  { name: 'Window Sensor', kind: 'sensor_contact', room: 'Bathroom', manufacturer: 'Aqara', model: 'MCCGQ11LM', placement: { x: 4.6, y: 1.7, z: 8.0, rotY: Math.PI }, state: { power: 'on', open: false, battery: 64, powerWatts: 0.02 } },

  // Hallway
  { name: 'Front Door', kind: 'lock', room: 'Hallway', manufacturer: 'Yale', model: 'Assure Lock 2', favorite: true, placement: { x: 8.9, y: 1.1, z: 6.5, rotY: -Math.PI / 2 }, state: { power: 'on', locked: true, battery: 74, powerWatts: 0.08 } },
  { name: 'Hallway Light', kind: 'light', room: 'Hallway', manufacturer: 'Philips Hue', model: 'White', placement: { x: 7.5, y: 2.6, z: 6.5 }, state: { power: 'off', brightness: 45, powerWatts: 0 } },

  // Office
  { name: 'Desk Light', kind: 'light', room: 'Office', manufacturer: 'BenQ', model: 'ScreenBar', favorite: true, placement: { x: 10.5, y: 1.25, z: 6.6 }, state: { power: 'on', brightness: 82, powerWatts: 9.4 } },
  { name: 'Air Purifier', kind: 'plug', room: 'Office', manufacturer: 'Coway', model: 'AP-1512', placement: { x: 11.5, y: 0.55, z: 7.4, rotY: -Math.PI / 2 }, state: { power: 'on', level: 70, powerWatts: 38, energyKwh: 143.9 } },

  // Garage / exterior
  { name: 'Garage Door', kind: 'garage', room: 'Garage', manufacturer: 'Chamberlain', model: 'MyQ', placement: { x: 3.5, y: 1.2, z: 12.8, rotY: Math.PI }, state: { power: 'off', open: false, powerWatts: 0 } },
  { name: 'Garage Camera', kind: 'camera', room: 'Garage', manufacturer: 'Arlo', model: 'Ultra 2', placement: { x: 1.2, y: 2.4, z: 12.2 }, state: { power: 'on', recording: false, powerWatts: 2.6 } },
  { name: 'Driveway Cam', kind: 'camera', room: 'Garage', manufacturer: 'Arlo', model: 'Pro 3', favorite: true, placement: { x: 3.5, y: 2.6, z: 9.6 }, state: { power: 'on', recording: false, powerWatts: 3.1 } },
  { name: 'Doorbell Cam', kind: 'doorbell', room: 'Hallway', manufacturer: 'Ring', model: 'Video Doorbell 4', placement: { x: 8.85, y: 1.6, z: 8.0, rotY: -Math.PI / 2 }, state: { power: 'on', recording: false, battery: 68, powerWatts: 1.1 } },
  { name: 'Robot Vacuum', kind: 'vacuum', room: 'Living Room', manufacturer: 'Roborock', model: 'S8 Pro Ultra', placement: { x: 2.2, y: 0.12, z: 3.4 }, state: { power: 'off', battery: 86, level: 86, powerWatts: 0.4 } },
];

const SCENES = [
  {
    name: 'Movie Night',
    icon: 'film',
    accent: '#7C5CFF',
    actions: [
      { deviceKind: 'light', command: 'turnOff' },
      { deviceKind: 'tv', command: 'turnOn' },
      { deviceKind: 'tv', command: 'setBacklight', args: { value: 20 } },
      { deviceKind: 'speaker', command: 'setVolume', args: { value: 42 } },
      { deviceKind: 'blinds', command: 'setPosition', args: { value: 0 } },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 20.5 } },
    ],
  },
  {
    name: 'Good Morning',
    icon: 'sunrise',
    accent: '#F2A03D',
    actions: [
      { deviceKind: 'light', command: 'setBrightness', args: { value: 45 } },
      { deviceKind: 'blinds', command: 'setPosition', args: { value: 100 } },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 21.5 } },
      { deviceKind: 'speaker', command: 'setPlaying', args: { value: 'Morning Focus' } },
    ],
  },
  {
    name: 'Good Night',
    icon: 'moon',
    accent: '#4C6FFF',
    actions: [
      { deviceKind: 'light', command: 'turnOff' },
      { deviceKind: 'tv', command: 'turnOff' },
      { deviceKind: 'speaker', command: 'pause' },
      { deviceKind: 'lock', command: 'lock' },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 18.5 } },
      { deviceKind: 'thermostat', command: 'setMode', args: { value: 'eco' } },
    ],
  },
  {
    name: 'Away',
    icon: 'shield',
    accent: '#2FB89C',
    actions: [
      { deviceKind: 'light', command: 'turnOff' },
      { deviceKind: 'tv', command: 'turnOff' },
      { deviceKind: 'speaker', command: 'pause' },
      { deviceKind: 'lock', command: 'lock' },
      { deviceKind: 'camera', command: 'setRecording', args: { value: true } },
      { deviceKind: 'thermostat', command: 'setMode', args: { value: 'eco' } },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 17 } },
    ],
  },
  {
    name: 'Focus',
    icon: 'target',
    accent: '#48C2E0',
    actions: [
      { deviceKind: 'light', command: 'setBrightness', args: { value: 85 } },
      { deviceKind: 'tv', command: 'turnOff' },
      { deviceKind: 'speaker', command: 'pause' },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 20 } },
    ],
  },
  {
    name: 'Relax',
    icon: 'leaf',
    accent: '#3DDC97',
    actions: [
      { deviceKind: 'light', command: 'setBrightness', args: { value: 20 } },
      { deviceKind: 'light', command: 'turnOn' },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 22 } },
      { deviceKind: 'speaker', command: 'setPlaying', args: { value: 'Ambient Piano' } },
      { deviceKind: 'speaker', command: 'setVolume', args: { value: 18 } },
    ],
  },
];

const AUTOMATIONS = [
  {
    name: 'Lights on at sunset',
    description: 'Turns on every light when the sun goes down.',
    trigger: { kind: 'sun_event', op: 'eq', value: 18 },
    conditions: [],
    actions: [{ deviceKind: 'light', command: 'turnOn' }],
  },
  {
    name: 'Nobody home energy saver',
    description: 'Drops the thermostat and switches everything off when the last person leaves.',
    trigger: { kind: 'presence', op: 'eq', value: 'away' },
    conditions: [],
    actions: [
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 17 } },
      { deviceKind: 'light', command: 'turnOff' },
      { deviceKind: 'tv', command: 'turnOff' },
    ],
  },
  {
    name: 'Leak emergency',
    description: 'Shuts off the water valve, flashes lights and records cameras when a leak is detected.',
    trigger: { kind: 'device_metric', deviceKind: 'sensor_leak', metric: 'leak', op: 'eq', value: true },
    conditions: [],
    actions: [
      { deviceKind: 'thermostat_valve', command: 'turnOff' },
      { deviceKind: 'light', command: 'setBrightness', args: { value: 100 } },
      { deviceKind: 'camera', command: 'setRecording', args: { value: true } },
      { deviceKind: 'speaker', command: 'setPlaying', args: { value: 'Emergency Alert' } },
    ],
  },
  {
    name: 'Goodnight at 23:00',
    description: 'Locks up, dims and drops the temperature before bed.',
    trigger: { kind: 'time_of_day', op: 'eq', value: 1380 },
    conditions: [],
    actions: [
      { deviceKind: 'lock', command: 'lock' },
      { deviceKind: 'light', command: 'turnOff' },
      { deviceKind: 'thermostat', command: 'setTargetTemperature', args: { value: 18.5 } },
    ],
  },
  {
    name: 'Hallway light on motion',
    description: 'Illuminates the hallway at low brightness whenever someone walks past.',
    trigger: { kind: 'device_metric', deviceKind: 'sensor_motion', metric: 'motion', op: 'eq', value: true },
    conditions: [{ deviceKind: 'thermostat', metric: 'power', op: 'neq', value: 'off' }],
    actions: [{ deviceId: 'hallway', command: 'setBrightness', args: { value: 30 } }],
  },
  {
    name: 'Fresh air when CO2 climbs',
    description: 'Runs the purifier when CO2 passes 900 ppm, off again below 700.',
    trigger: { kind: 'device_metric', deviceKind: 'air_quality', metric: 'co2', op: 'gt', value: 900 },
    conditions: [],
    actions: [{ deviceKind: 'plug', command: 'turnOn' }, { deviceKind: 'fan', command: 'setLevel', args: { value: 70 } }],
  },
];

export function isSeeded(): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM homes').get() as { c: number };
  return row.c > 0;
}

export function seed(): { homeId: string; userId: string; email: string } {
  const ts = simNow();
  const userId = uid('usr_');
  const homeId = uid('home_');
  const email = 'demo@smartliving.app';

  db.prepare('INSERT INTO users (id, email, name, password_hash, avatar_hue, currency, energy_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    userId,
    email,
    'Alex Rivera',
    hashPassword('demo1234'),
    214,
    'USD',
    0.28,
    ts,
  );

  db.prepare('INSERT INTO homes (id, user_id, name, lat, lon, sqft, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    homeId,
    userId,
    'Maple House',
    51.5074,
    -0.1278,
    1420,
    'Europe/London',
    ts,
  );

  const roomIds = new Map<string, string>();
  for (const r of ROOMS) {
    roomIds.set(r.name, insertRoom(homeId, r.name, r.kind, r.accent, r.bounds));
  }

  const weather = simulateWeather(51.5074, ts);
  const presence = simulatePresence(ts, 3);
  const indoorBase = 21 + (presence.home ? 0.4 : -0.6) + (weather.outdoorTemp - 16) * 0.05;

  for (const d of DEVICES) {
    const state: DeviceState = { ...d.state };
    if (state.temperature !== undefined) state.temperature = Math.round(indoorBase * 10) / 10;
    if (state.humidity !== undefined) state.humidity = Math.round(weather.outdoorHumidity);
    insertDevice({
      home_id: homeId,
      room_id: roomIds.get(d.room) ?? null,
      name: d.name,
      kind: d.kind,
      manufacturer: d.manufacturer,
      model: d.model,
      favorite: d.favorite ? 1 : 0,
      state,
      placement: d.placement,
    });
  }

  for (const s of SCENES) {
    const id = uid('scene_');
    db.prepare('INSERT INTO scenes (id, home_id, name, icon, accent, actions, run_count, last_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      homeId,
      s.name,
      s.icon,
      s.accent,
      JSON.stringify(s.actions),
      Math.floor(Math.random() * 40),
      ts - Math.floor(Math.random() * 6) * 3600000,
      ts,
    );
  }

  // Resolve the one automation that references a device by name.
  const hallway = db.prepare("SELECT id FROM devices WHERE home_id = ? AND name = ?").get(homeId, 'Hallway Light') as { id: string } | undefined;

  for (const a of AUTOMATIONS) {
    const actions = JSON.parse(JSON.stringify(a.actions)) as Array<{ deviceId?: string }>;
    if (hallway) {
      for (const act of actions) {
        if (act.deviceId === 'hallway') act.deviceId = hallway.id;
      }
    }
    db.prepare('INSERT INTO automations (id, home_id, name, description, enabled, trigger, conditions, actions, run_count, last_run_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)').run(
      uid('auto_'),
      homeId,
      a.name,
      a.description,
      JSON.stringify(a.trigger),
      JSON.stringify(a.conditions),
      JSON.stringify(actions),
      Math.floor(Math.random() * 120),
      ts - Math.floor(Math.random() * 48) * 3600000,
      ts,
    );
  }

  // Backfill 48h of plausible energy history so charts are not empty.
  const minuteNow = Math.floor(ts / 60000);
  const insertSample = db.prepare('INSERT OR REPLACE INTO energy_samples (home_id, minute, watts) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (let i = 48 * 60; i >= 0; i--) {
      const minute = minuteNow - i;
      const at = minute * 60000;
      const w = simulateWeather(51.5074, at);
      const sun = sunPosition(51.5074, -0.1278, at);
      const p = simulatePresence(at, 3);
      let watts = 42;
      watts += p.home ? 210 : 26;
      watts += sun.altitude > 0 ? Math.max(0, Math.sin((sun.altitude * Math.PI) / 180)) * 130 : 0;
      watts += w.outdoorTemp < 8 ? 420 : 0;
      watts += Math.sin((minute / 1440) * Math.PI * 2 * 3) * 18;
      watts += (Math.random() - 0.5) * 26;
      watts = Math.max(18, watts);
      insertSample.run(homeId, minute, Math.round(watts * 10) / 10);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const sun = sunPosition(51.5074, -0.1278, ts);
  insertEvent({
    home_id: homeId,
    kind: 'system',
    severity: 'info',
    title: 'Home created',
    body: `Smart Living is monitoring ${DEVICES.length} devices across ${ROOMS.length} rooms.`,
  });
  insertEvent({
    home_id: homeId,
    kind: 'security',
    severity: 'info',
    title: presence.home ? 'Arrived home' : 'Left home',
    body: presence.home ? 'Front door unlocked automatically.' : 'Away mode armed, all cameras recording.',
  });
  if (sun.altitude > 0) {
    insertEvent({
      home_id: homeId,
      kind: 'system',
      severity: 'info',
      title: 'Sunrise',
      body: `Sunrise at ${Math.floor(sun.sunriseMin / 60)}:${String(Math.floor(sun.sunriseMin % 60)).padStart(2, '0')}, sunset ${Math.floor(sun.sunsetMin / 60)}:${String(Math.floor(sun.sunsetMin % 60)).padStart(2, '0')}.`,
    });
  }

  return { homeId, userId, email };
}