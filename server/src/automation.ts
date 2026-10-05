import type { Action, Automation, Condition, DeviceState, ParsedDevice, Trigger } from './types.ts';
import { jsonGet } from './db.ts';
import { getDevice, listDevices, saveDeviceState } from './store.ts';
import { clamp } from './sim/physics.ts';

export interface CommandResult {
  deviceId: string;
  name: string;
  ok: boolean;
  message: string;
  state: DeviceState;
}

function readMetric(state: DeviceState, metric: string): number | string | boolean | null {
  const map: Record<string, unknown> = {
    power: state.power,
    brightness: state.brightness,
    level: state.level,
    temperature: state.temperature,
    targetTemperature: state.targetTemperature,
    humidity: state.humidity,
    co2: state.co2,
    pm25: state.pm25,
    battery: state.battery,
    powerWatts: state.powerWatts,
    locked: state.locked,
    open: state.open,
    motion: state.motion,
    leak: state.leak,
    position: state.position,
    playing: state.playing,
  };
  const v = map[metric];
  return v === undefined ? null : (v as number | string | boolean | null);
}

export function compare(op: Trigger['op'], actual: unknown, expected: unknown): boolean {
  if (op === 'changed') return true;
  if (Array.isArray(expected)) {
    const num = Number(actual);
    return typeof num === 'number' && !Number.isNaN(num) && num >= Number(expected[0]) && num <= Number(expected[1]);
  }
  if (typeof expected === 'number') {
    const num = Number(actual);
    if (Number.isNaN(num)) return false;
    switch (op) {
      case 'eq':
        return Math.abs(num - expected) < 0.001;
      case 'neq':
        return Math.abs(num - expected) >= 0.001;
      case 'gt':
        return num > expected;
      case 'gte':
        return num >= expected;
      case 'lt':
        return num < expected;
      case 'lte':
        return num <= expected;
      default:
        return false;
    }
  }
  if (typeof expected === 'boolean') {
    return Boolean(actual) === expected;
  }
  return String(actual) === String(expected);
}

function resolveDevices(homeId: string, deviceId?: string, deviceKind?: string): ParsedDevice[] {
  if (deviceId) {
    const d = getDevice(deviceId);
    return d && d.home_id === homeId ? [d] : [];
  }
  if (deviceKind) {
    return listDevices(homeId).filter((d) => d.kind === deviceKind);
  }
  return [];
}

/** Executes a single device command. This is the one place state actually changes. */
export function executeCommand(
  homeId: string,
  command: string,
  args: Record<string, unknown>,
  target: { deviceId?: string; deviceKind?: string },
): CommandResult[] {
  const targets = resolveDevices(homeId, target.deviceId, target.deviceKind);
  const results: CommandResult[] = [];

  for (const device of targets) {
    const s: DeviceState = { ...device.state };
    let message = '';

    switch (command) {
      case 'turnOn':
        s.power = 'on';
        message = 'turned on';
        break;
      case 'turnOff':
        s.power = 'off';
        if (device.kind === 'light') s.brightness = 0;
        message = 'turned off';
        break;
      case 'toggle':
        s.power = s.power === 'on' ? 'off' : 'on';
        message = s.power === 'on' ? 'turned on' : 'turned off';
        break;
      case 'setBrightness':
        s.brightness = clamp(Number(args.value ?? 50), 1, 100);
        s.power = 'on';
        message = `brightness ${Math.round(s.brightness)}%`;
        break;
      case 'setBacklight':
        s.brightnessBacklight = clamp(Number(args.value ?? 50), 5, 100);
        message = `backlight ${Math.round(s.brightnessBacklight)}%`;
        break;
      case 'setLevel':
        s.level = clamp(Number(args.value ?? 50), 0, 100);
        message = `level ${Math.round(s.level)}%`;
        break;
      case 'setVolume':
        s.volume = clamp(Number(args.value ?? 30), 0, 100);
        s.power = 'on';
        message = `volume ${Math.round(s.volume)}%`;
        break;
      case 'setTargetTemperature':
        s.targetTemperature = clamp(Number(args.value ?? 21), 5, 32);
        message = `set to ${s.targetTemperature}°C`;
        break;
      case 'setMode':
        s.mode = String(args.value ?? 'heat');
        message = `mode ${s.mode}`;
        break;
      case 'lock':
        s.locked = true;
        message = 'locked';
        break;
      case 'unlock':
        s.locked = false;
        message = 'unlocked';
        break;
      case 'setPosition':
        s.position = clamp(Number(args.value ?? 0), 0, 100);
        s.level = s.position;
        message = `${Math.round(s.position)}% open`;
        break;
      case 'setPlaying':
        s.playing = args.value == null ? null : String(args.value);
        s.power = 'on';
        message = s.playing ? `playing ${s.playing}` : 'stopped playback';
        break;
      case 'pause':
        s.playing = null;
        message = 'paused';
        break;
      case 'setRecording':
        s.recording = Boolean(args.value);
        message = s.recording ? 'recording' : 'recording off';
        break;
      case 'vacuumStart':
        s.power = 'on';
        message = 'cleaning started';
        break;
      case 'dock':
        s.power = 'off';
        message = 'returned to dock';
        break;
      case 'eco':
        s.mode = 'eco';
        message = 'eco mode';
        break;
      default:
        results.push({ deviceId: device.id, name: device.name, ok: false, message: `unknown command "${command}"`, state: s });
        continue;
    }

    saveDeviceState(device.id, s);
    results.push({ deviceId: device.id, name: device.name, ok: true, message, state: s });
  }

  if (targets.length === 0) {
    results.push({ deviceId: target.deviceId ?? 'none', name: 'No matching device', ok: false, message: 'no target', state: { power: 'off' } });
  }
  return results;
}

export interface TriggerEvaluation {
  automation: Automation;
  matched: boolean;
  reason: string;
}

/** Subset of the simulated weather that weather triggers can read. */
export interface WeatherLike {
  outdoorTemp: number;
  outdoorHumidity: number;
  condition: string;
  windKph: number;
  uvIndex: number;
  rainMmPerHour: number;
}

/** Stateless check: does the current home state satisfy this automation's trigger? */
export function evaluateTrigger(automation: Automation, ctx: { now: number; localMinutes: number; presenceHome: boolean; weather?: WeatherLike }): TriggerEvaluation {
  const trigger = jsonGet<Trigger | null>(automation.trigger, null);
  if (!trigger) return { automation, matched: false, reason: 'no trigger' };

  switch (trigger.kind) {
    case 'time_of_day': {
      const wanted = Number(trigger.value);
      const hit = Math.abs(ctx.localMinutes - wanted) <= 1.5;
      return { automation, matched: hit, reason: `time ${fmtMinutes(ctx.localMinutes)} vs ${fmtMinutes(wanted)}` };
    }
    case 'presence': {
      const wantedHome = trigger.value === 'home' || trigger.value === true;
      const hit = wantedHome ? ctx.presenceHome : !ctx.presenceHome;
      return { automation, matched: hit, reason: `presence=${ctx.presenceHome ? 'home' : 'away'}` };
    }
    case 'device_state':
    case 'device_metric': {
      const devices = resolveDevicesByAutomation(automation.home_id, trigger);
      if (devices.length === 0) return { automation, matched: false, reason: 'no target device' };
      const metric = trigger.metric ?? 'power';
      const values = devices.map((d) => readMetric(d.state, metric));
      const hit = values.some((v) => compare(trigger.op, v, trigger.value));
      return {
        automation,
        matched: hit,
        reason: `${metric}=${values.map((v) => (v === null ? 'n/a' : String(v))).join('/')} ${trigger.op} ${JSON.stringify(trigger.value)}`,
      };
    }
    case 'weather': {
      const weather = ctx.weather;
      if (!weather) return { automation, matched: false, reason: 'weather unavailable' };
      const metric = trigger.metric ?? 'outdoorTemp';
      const raw = (weather as unknown as Record<string, unknown>)[metric];
      const reading = typeof raw === 'number' ? raw : raw === undefined ? null : Number(raw);
      if (reading === null || Number.isNaN(reading)) {
        return { automation, matched: false, reason: `unknown metric ${metric}` };
      }

      if (trigger.op === 'between' && Array.isArray(trigger.value)) {
        const [low, high] = trigger.value as [number, number];
        const hit = reading >= Math.min(low, high) && reading <= Math.max(low, high);
        return { automation, matched: hit, reason: `${metric}=${reading} in [${low}, ${high}]` };
      }
      if (typeof trigger.value === 'string') {
        const hit = weather.condition === trigger.value;
        return { automation, matched: hit, reason: `condition=${weather.condition} eq ${trigger.value}` };
      }
      const hit = compare(trigger.op, reading, trigger.value);
      return { automation, matched: hit, reason: `${metric}=${reading} ${trigger.op} ${JSON.stringify(trigger.value)}` };
    }
    case 'sun_event': {
      const minutes = Number(trigger.value);
      const local = ctx.localMinutes;
      let hit = false;
      if (minutes === 0) hit = local >= 0 && local < 2;
      else if (minutes === 6) hit = local >= 6 * 60 && local < 6 * 60 + 2;
      else if (minutes === 18) hit = local >= 18 * 60 && local < 18 * 60 + 2;
      else if (minutes === 22) hit = local >= 22 * 60 && local < 24 * 60;
      return { automation, matched: hit, reason: `sun@${minutes} local=${fmtMinutes(local)}` };
    }
    default:
      return { automation, matched: false, reason: 'unsupported trigger' };
  }
}

function resolveDevicesByAutomation(homeId: string, trigger: Trigger): ParsedDevice[] {
  if (trigger.deviceId) {
    const d = getDevice(trigger.deviceId);
    return d && d.home_id === homeId ? [d] : [];
  }
  if (trigger.deviceKind) return listDevices(homeId).filter((d) => d.kind === trigger.deviceKind);
  return [];
}

export function checkConditions(automation: Automation): boolean {
  const conditions = jsonGet<Condition[]>(automation.conditions, []);
  if (conditions.length === 0) return true;
  for (const c of conditions) {
    const devices = resolveDevices(automation.home_id, c.deviceId, c.deviceKind);
    if (devices.length === 0) return false;
    const ok = devices.every((d) => {
      const v = readMetric(d.state, c.metric ?? 'power');
      return compare(c.op as Trigger['op'], v, c.value);
    });
    if (!ok) return false;
  }
  return true;
}

export async function runAutomation(automation: Automation): Promise<CommandResult[]> {
  const actions = jsonGet<Action[]>(automation.actions, []);
  const out: CommandResult[] = [];
  for (const action of actions) {
    const delay = action.delayMs ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 5000)));
    }
    out.push(
      ...executeCommand(automation.home_id, action.command, action.args ?? {}, {
        deviceId: action.deviceId,
        deviceKind: action.deviceKind,
      }),
    );
  }
  return out;
}

export function fmtMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}