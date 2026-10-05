export type DeviceKind =
  | 'light'
  | 'thermostat'
  | 'lock'
  | 'camera'
  | 'sensor_motion'
  | 'sensor_leak'
  | 'sensor_contact'
  | 'plug'
  | 'speaker'
  | 'tv'
  | 'blinds'
  | 'fan'
  | 'air_quality'
  | 'doorbell'
  | 'garage'
  | 'vacuum'
  | 'thermostat_valve';

export interface DeviceState {
  power?: 'on' | 'off' | 'standby';
  brightness?: number;
  level?: number;
  temperature?: number;
  targetTemperature?: number;
  humidity?: number;
  co2?: number;
  voc?: number;
  pm25?: number;
  locked?: boolean;
  open?: boolean;
  motion?: boolean;
  motionDetected?: boolean;
  leak?: boolean;
  battery?: number;
  powerWatts?: number;
  energyKwh?: number;
  volume?: number;
  playing?: string | null;
  brightnessBacklight?: number;
  position?: number;
  mode?: string;
  recording?: boolean;
  lastMotionAt?: number | null;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY?: number;
  scale?: number;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  roomId: string | null;
  roomName: string | null;
  manufacturer: string;
  model: string;
  favorite: boolean;
  category: string;
  state: DeviceState;
  placement: Placement;
  updatedAt: number;
}

export interface Room {
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
  deviceCount: number;
}

export interface Presence {
  home: boolean;
  peopleHome: number;
  asleep: boolean;
  awayUntil: number | null;
}

export interface Weather {
  outdoorTemp: number;
  outdoorHumidity: number;
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'wind';
  cloudCover: number;
  windKph: number;
  uvIndex: number;
  rainMmPerHour: number;
}

export interface Sun {
  altitude: number;
  azimuth: number;
  sunriseMin: number;
  sunsetMin: number;
}

export interface HomeSnapshot {
  home: { id: string; name: string; sqft: number; lat: number; lon: number; timezone: string };
  rooms: Room[];
  presence: Presence;
  weather: Weather;
  sun: Sun;
  localTime: string;
  localMinutes: number;
  power: { totalWatts: number; byCategory: Record<string, number> };
  counts: { total: number; on: number; favorites: number; alerts: number };
}

export interface Scene {
  id: string;
  name: string;
  icon: string;
  accent: string;
  actions: Array<Record<string, unknown>>;
  run_count: number;
  last_run_at: number | null;
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: Trigger;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Action>;
  run_count: number;
  last_run_at: number | null;
}

export interface Trigger {
  kind: 'device_state' | 'device_metric' | 'time_of_day' | 'sun_event' | 'presence' | 'weather';
  deviceId?: string;
  deviceKind?: DeviceKind;
  metric?: string;
  op: string;
  value: unknown;
}

export interface Action {
  deviceId?: string;
  deviceKind?: DeviceKind;
  command: string;
  args?: Record<string, unknown>;
}

export interface EnergyReport {
  currency: string;
  ratePerKwh: number;
  today: { kwh: number; cost: number; avgWatts: number; peakWatts: number; peakAt: number | null; vsYesterdayPct: number };
  yesterday: { kwh: number; cost: number };
  month: { kwh: number; cost: number; projectedKwh: number; projectedCost: number };
  byCategory: Array<{ category: string; kwh: number; cost: number; pct: number }>;
  hourly: Array<{ label: string; startMinute: number; kwh: number; cost: number; avgWatts: number }>;
  byRoom: Array<{ room: string; kwh: number; cost: number; pct: number }>;
  weekOverWeekPct: number;
  topConsumers: Array<{ id: string; name: string; kind: DeviceKind; kwh: number; cost: number }>;
}

export interface Insight {
  id: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  savingsKwh?: number;
  deviceId?: string;
}

export interface HomeEvent {
  id: string;
  device_id: string | null;
  deviceName: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  at: number;
  acknowledged: number;
}

export interface AiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  at?: number;
  meta?: Record<string, unknown> | null;
}

export interface SimState {
  scale: number;
  simNow: number;
  realNow: number;
  localTime: string;
  sun: Sun;
  presence: Presence;
  weather: Weather;
}

export interface Profile {
  user: { id: string; email: string; name: string; avatarHue: number; currency: string; energyRate: number };
  home: { id: string; name: string; sqft: number; lat: number; lon: number; timezone: string };
}