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

export type PowerState = 'on' | 'off' | 'standby';

export interface DeviceState {
  power: PowerState;
  brightness?: number; // 0..100
  level?: number; // generic 0..100 (fan speed, blind %)
  temperature?: number; // C
  targetTemperature?: number; // C
  humidity?: number; // %
  co2?: number; // ppm
  voc?: number; // ppb
  pm25?: number; // ug/m3
  locked?: boolean;
  open?: boolean;
  motion?: boolean;
  leak?: boolean;
  battery?: number; // %
  powerWatts?: number;
  energyKwh?: number;
  volume?: number; // 0..100
  playing?: string | null;
  brightnessBacklight?: number;
  position?: number; // 0 closed .. 100 open
  mode?: string;
  recording?: boolean;
  lastMotionAt?: number | null;
  /** transient edge flags, set for one tick only */
  pressed?: boolean;
  motionDetected?: boolean;
}

export interface DeviceRow {
  id: string;
  home_id: string;
  room_id: string | null;
  name: string;
  kind: DeviceKind;
  manufacturer: string;
  model: string;
  favorite: number;
  state: string; // JSON DeviceState
  placement: string; // JSON {x,y,z,rotY,scale}
  created_at: number;
  updated_at: number;
}

export interface ParsedDevice extends Omit<DeviceRow, 'favorite' | 'state' | 'placement'> {
  favorite: boolean;
  state: DeviceState;
  placement: { x: number; y: number; z: number; rotY?: number; scale?: number };
}

export type TriggerKind =
  | 'device_state'
  | 'device_metric'
  | 'time_of_day'
  | 'sun_event'
  | 'presence'
  | 'weather';

export interface Trigger {
  kind: TriggerKind;
  deviceId?: string;
  deviceKind?: DeviceKind;
  metric?: 'temperature' | 'humidity' | 'co2' | 'pm25' | 'battery' | 'powerWatts' | 'motion' | 'leak' | 'open' | 'locked';
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'changed';
  value: number | string | boolean | [number, number];
}

export interface Condition {
  deviceId?: string;
  deviceKind?: DeviceKind;
  metric?: string;
  op: string;
  value: number | string | boolean;
}

export interface Action {
  deviceId?: string;
  deviceKind?: DeviceKind;
  command: string;
  args?: Record<string, unknown>;
  delayMs?: number;
}

export interface Automation {
  id: string;
  home_id: string;
  name: string;
  description: string | null;
  /** Raw rows store 0/1; the store normalises this to a boolean on read. */
  enabled: number | boolean;
  trigger: string; // JSON Trigger
  conditions: string; // JSON Condition[]
  actions: string; // JSON Action[]
  run_count: number;
  last_run_at: number | null;
  created_at: number;
}

export interface EnergyReading {
  minute: number;
  watts: number;
}

export type RealtimeEventType =
  | 'telemetry'
  | 'state'
  | 'event'
  | 'automation'
  | 'presence'
  | 'weather'
  | 'energy'
  | 'hello'
  | 'subscribed';

export interface TelemetryEvent {
  type: RealtimeEventType;
  homeId?: string;
  deviceId?: string;
  payload: unknown;
  at: number;
}