import type { DeviceKind, DeviceState } from '../types.ts';
import { clamp, round0, round1, type HomeContext } from './physics.ts';

const noise = (seed: number) => {
  const x = Math.sin(seed * 91.7) * 43758.5453;
  return x - Math.floor(x);
};

function drift(value: number, target: number, perTick: number): number {
  const delta = target - value;
  return value + clamp(delta, -perTick, perTick);
}

/**
 * Advance one device by `dt` seconds.
 * Returns the new full state plus the fields worth streaming over the wire.
 */
export function stepDevice(
  kind: DeviceKind,
  state: DeviceState,
  ctx: HomeContext,
  seed: number,
  dt: number,
): { state: DeviceState; changed: Partial<DeviceState>; watts: number } {
  const s: DeviceState = { ...state };
  const changed: Partial<DeviceState> = {};
  const presence = ctx.presence.home ? 1 : 0;
  const occupied = ctx.presence.peopleHome;
  const dayFactor = ctx.sun.altitude > 0 ? 1 : 0;
  const daylight = clamp(ctx.sun.altitude / 60, 0, 1) * (1 - ctx.weather.cloudCover * 0.6);
  const jitter = noise(seed + ctx.tickSeconds) - 0.5;

  let watts = 0.4; // idle electronics draw

  switch (kind) {
    case 'light': {
      if (s.power === 'on') {
        const b = clamp((s.brightness ?? 70) / 100, 0.02, 1);
        watts = 0.6 + b * 11.5 + jitter * 0.15;
        s.powerWatts = round1(watts);
        changed.powerWatts = s.powerWatts;
      } else {
        s.powerWatts = 0;
        watts = 0.05;
        changed.powerWatts = 0;
      }
      break;
    }

    case 'thermostat': {
      const target = s.targetTemperature ?? 21;
      const indoor = s.temperature ?? 21;
      const outdoor = ctx.weather.outdoorTemp;
      // Envelope heat loss: stronger when it's colder outside.
      const loss = 0.00015 * (indoor - outdoor) + 0.00005;
      const solarGain = daylight * 0.00035;
      const internalGain = occupied * 0.00022;

      const wantsHeat = indoor < target - 0.4;
      const wantsCool = indoor > target + 0.4;
      const mode = s.mode ?? 'heat';
      const active = mode === 'off' ? false : mode === 'heat' ? wantsHeat : wantsCool;

      let hvacWatts = 0;
      if (mode === 'off') {
        hvacWatts = 0.6;
      } else if (active) {
        hvacWatts = (mode === 'heat' ? 1450 : 1180) + Math.abs(indoor - target) * 190;
      } else {
        hvacWatts = 2.5; // fan idle, holding setpoint
      }

      // Rates are per simulated second and deliberately small: a real room
      // moves roughly 4 C per hour under load.
      const hvacRate = active ? (mode === 'heat' ? 0.0022 : -0.0018) : 0;
      s.temperature = indoor + (hvacRate - loss + solarGain + internalGain) * dt;
      s.powerWatts = round0(hvacWatts);
      s.power = hvacWatts > 100 ? 'on' : hvacWatts > 1 ? 'standby' : 'off';
      changed.temperature = s.temperature;
      changed.powerWatts = s.powerWatts;
      changed.power = s.power;

      const humidityTarget = clamp(ctx.weather.outdoorHumidity + 6, 30, 70);
      s.humidity = drift(s.humidity ?? 45, humidityTarget - (mode === 'cool' ? 12 : 0), 0.004 * dt);
      watts = hvacWatts;
      break;
    }

    case 'lock': {
      if (s.battery === undefined) s.battery = 82;
      s.battery = clamp(s.battery - 0.0000016 * dt * (s.locked ? 1 : 1.3), 1, 100);
      changed.battery = s.battery;
      watts = 0.08;
      s.powerWatts = 0.1;
      break;
    }

    case 'camera':
    case 'doorbell': {
      const motion = occupied > 0 && noise(seed * 3 + Math.floor(ctx.tickSeconds / 7)) > (occupied > 1 ? 0.55 : 0.72);
      if (motion) s.lastMotionAt = Date.now();
      if (s.recording === undefined) s.recording = false;
      if (kind === 'camera') {
        const armed = !ctx.presence.home;
        const shouldRecord = (s.power === 'on') && (armed || motion);
        if (shouldRecord !== s.recording) {
          s.recording = shouldRecord;
          changed.recording = shouldRecord;
        }
        watts = s.power === 'on' ? (shouldRecord ? 5.2 : 2.6) + jitter * 0.2 : 0.4;
      } else {
        const pressed = noise(seed * 7 + Math.floor(ctx.tickSeconds / 5)) > 0.985;
        if (pressed) {
          s.lastMotionAt = Date.now();
          changed.pressed = true;
        }
        watts = 1.1 + jitter * 0.05;
      }
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      if (motion) changed.motionDetected = true;
      break;
    }

    case 'sensor_motion': {
      const baseline = occupied > 0 ? 0.45 : 0.94;
      const active = noise(seed * 11 + Math.floor(ctx.tickSeconds / 3)) > baseline;
      if (active !== s.motion) {
        s.motion = active;
        changed.motion = active;
        if (active) {
          s.lastMotionAt = Date.now();
          changed.lastMotionAt = s.lastMotionAt;
        }
      }
      if (s.battery !== undefined) {
        s.battery = clamp(s.battery - 0.0000042 * dt, 0, 100);
        changed.battery = s.battery;
      }
      watts = 0.04;
      break;
    }

    case 'sensor_leak': {
      if (s.leak === undefined) s.leak = false;
      // Pipe sensors occasionally pick up a transient from washer/dishwasher.
      const spike = ctx.presence.home && noise(seed * 13 + Math.floor(ctx.tickSeconds / 400)) > 0.997;
      if (spike && !s.leak) {
        s.leak = true;
        changed.leak = true;
      } else if (s.leak && noise(seed * 17 + Math.floor(ctx.tickSeconds / 200)) > 0.5) {
        s.leak = false;
        changed.leak = false;
      }
      if (s.battery !== undefined) {
        s.battery = clamp(s.battery - 0.0000038 * dt, 0, 100);
        changed.battery = s.battery;
      }
      watts = 0.03;
      break;
    }

    case 'sensor_contact': {
      if (s.open === undefined) s.open = false;
      const shouldOpen = occupied > 0 && noise(seed * 19 + Math.floor(ctx.tickSeconds / 90)) > 0.86;
      if (shouldOpen !== s.open) {
        s.open = shouldOpen;
        changed.open = shouldOpen;
      }
      if (s.battery !== undefined) {
        s.battery = clamp(s.battery - 0.0000031 * dt, 0, 100);
        changed.battery = s.battery;
      }
      watts = 0.02;
      break;
    }

    case 'air_quality': {
      if (s.co2 === undefined) s.co2 = 480;
      // CO2 generation from people, removal by ventilation and filtration.
      const gain = occupied * 0.55;
      const decay = (s.power === 'on' ? 1.7 : 0.5) * (0.6 + daylight * 0.4);
      s.co2 = clamp(s.co2 + (gain - decay) * dt, 400, 2500);

      const outdoorPm = ctx.weather.condition === 'rain' ? 3 : ctx.weather.condition === 'clear' ? 9 : 6;
      s.pm25 = drift(s.pm25 ?? 6, outdoorPm + occupied * 2.5, 0.012 * dt);

      const vocTarget = 55 + occupied * 34 + (ctx.presence.asleep ? -20 : 0);
      s.voc = drift(s.voc ?? 90, vocTarget, 0.06 * dt);

      s.humidity = drift(s.humidity ?? 45, ctx.weather.outdoorHumidity, 0.02 * dt);
      s.temperature = drift(s.temperature ?? 21, 21.5 + occupied * 0.6 + daylight * 1.2, 0.0025 * dt);
      changed.co2 = s.co2;
      changed.pm25 = s.pm25;
      changed.voc = s.voc;
      changed.temperature = s.temperature;
      changed.humidity = s.humidity;
      watts = s.power === 'on' ? 1.4 : 0.06;
      s.powerWatts = watts;
      break;
    }

    case 'plug': {
      if (s.power === 'on') {
        // Fridge-style duty cycle: compressor runs ~35% of the time.
        const cycle = noise(seed * 23 + ctx.tickSeconds / 40);
        const duty = 0.34;
        const load = clamp((s.level ?? 60) / 100, 0, 1);
        watts = cycle < duty ? 45 + load * 210 : 0.6;
        watts += jitter * 1.2;
      } else {
        watts = 0.1;
      }
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      if (s.energyKwh !== undefined) s.energyKwh = (s.energyKwh ?? 0) + (watts * dt) / 3600000;
      break;
    }

    case 'speaker': {
      if (s.power === 'on') {
        const v = (s.volume ?? 35) / 100;
        watts = 1.2 + v * v * 16 + (s.playing ? 3.5 : 0);
      } else watts = 0.7;
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      break;
    }

    case 'tv': {
      if (s.power === 'on') {
        // Modern panels draw less as brightness comes down.
        const backlight = clamp((s.brightnessBacklight ?? 60) / 100, 0, 1);
        watts = 22 + (1 - backlight) * 55 + (s.playing ? 8 : 0);
      } else watts = 0.6;
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      break;
    }

    case 'blinds': {
      const target = s.position ?? 0;
      if (Math.abs((s.level ?? target) - target) > 0.5) {
        s.level = drift(s.level ?? target, target, 6 * dt);
        s.position = round0(s.level);
        changed.position = s.position;
        s.powerWatts = 3.4;
        s.power = 'on';
      } else {
        s.position = round0(target);
        s.powerWatts = 0.05;
        s.power = 'off';
      }
      watts = s.powerWatts;
      break;
    }

    case 'fan': {
      const speed = clamp(s.level ?? 0, 0, 100);
      if (s.power === 'on' && speed > 0) {
        watts = 2 + (speed / 100) * 26;
        // Airflow visibly cools the room.
        s.temperature = (s.temperature ?? 21) - (speed / 100) * 0.0006 * dt;
        changed.temperature = s.temperature;
      } else {
        watts = 0.5;
      }
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      break;
    }

    case 'vacuum': {
      if (s.power === 'on') {
        s.battery = clamp((s.battery ?? 90) - 0.08 * dt, 0, 100);
        s.level = round0(clamp(100 - (100 - (s.battery ?? 90)) * 1.6, 0, 100));
        watts = 24 + jitter * 1.5;
      } else {
        watts = 0.4;
        s.battery = clamp((s.battery ?? 90) + 0.02 * dt, 0, 100);
      }
      s.powerWatts = round1(watts);
      changed.powerWatts = s.powerWatts;
      changed.battery = s.battery ?? 0;
      changed.level = s.level ?? 0;
      break;
    }

    case 'garage': {
      if (s.open === undefined) s.open = false;
      s.powerWatts = s.open ? 120 : 0.05;
      watts = s.powerWatts;
      changed.powerWatts = s.powerWatts;
      break;
    }

    case 'thermostat_valve': {
      const target = s.targetTemperature ?? 19;
      const indoor = s.temperature ?? 20;
      const heating = indoor < target - 0.3 && s.power === 'on';
      s.level = heating ? 65 : 0;
      watts = heating ? 1800 : 0.2;
      s.powerWatts = round0(watts);
      s.temperature = indoor + (heating ? 0.0014 : -0.0002) * dt;
      changed.level = s.level;
      changed.powerWatts = s.powerWatts;
      changed.temperature = s.temperature;
      break;
    }
  }

  if (state.energyKwh !== undefined && kind !== 'plug') {
    s.energyKwh = state.energyKwh + (watts * dt) / 3600000;
  }

  return { state: s, changed, watts };
}

/** Estimated instantaneous whole-home draw plus a per-category breakdown. */
export function powerSummary(devices: Array<{ kind: DeviceKind; state: DeviceState }>): {
  totalWatts: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  let totalWatts = 0;
  for (const d of devices) {
    const w = d.state.powerWatts ?? 0;
    totalWatts += w;
    const cat = CATEGORY[d.kind] ?? 'Other';
    byCategory[cat] = (byCategory[cat] ?? 0) + w;
  }
  return { totalWatts: round1(totalWatts), byCategory };
}

export const CATEGORY: Partial<Record<DeviceKind, string>> = {
  light: 'Lighting',
  thermostat: 'Climate',
  thermostat_valve: 'Climate',
  fan: 'Climate',
  blinds: 'Climate',
  plug: 'Appliances',
  tv: 'Media',
  speaker: 'Media',
  camera: 'Security',
  doorbell: 'Security',
  lock: 'Security',
  sensor_motion: 'Sensors',
  sensor_leak: 'Sensors',
  sensor_contact: 'Sensors',
  air_quality: 'Sensors',
  vacuum: 'Cleaning',
  garage: 'Security',
};