/**
 * Deterministic-ish physical simulation of a smart home.
 * Everything here is driven by a wall-clock tick so the app shows data that
 * moves the way a real house behaves: sun position, HVAC load, occupancy,
 * air quality, battery drain and power draw.
 */

export interface SunPosition {
  altitude: number; // degrees above horizon
  azimuth: number; // degrees from north
  sunriseMin: number; // minutes from local midnight
  sunsetMin: number;
}

export interface WeatherNow {
  outdoorTemp: number;
  outdoorHumidity: number;
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'wind';
  cloudCover: number; // 0..1
  windKph: number;
  uvIndex: number;
  rainMmPerHour: number;
}

export interface HomeContext {
  homeId: string;
  lat: number;
  lon: number;
  rooms: Array<{ id: string; kind: string }>;
  presence: {
    home: boolean;
    peopleHome: number;
    asleep: boolean;
    awayUntil: number | null;
  };
  weather: WeatherNow;
  sun: SunPosition;
  tickSeconds: number;
}

const DEG = Math.PI / 180;

function toRad(d: number): number {
  return d * DEG;
}

function toDeg(r: number): number {
  return r / DEG;
}

/** Local solar time offset in minutes from UTC, derived from longitude. */
function longitudeOffsetMinutes(lon: number): number {
  return (lon / 15) * 60;
}

export function sunPosition(lat: number, lon: number, at: number): SunPosition {
  const utcMinutes = ((at / 60000) % 1440 + 1440) % 1440;
  const localMinutes = utcMinutes + longitudeOffsetMinutes(lon);

  const date = new Date(at);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86400000);

  // Solar declination (NOAA approximation)
  const declination = 23.45 * Math.sin(toRad((360 / 365) * (dayOfYear - 81)));

  // Equation of time (minutes)
  const b = toRad((360 / 364) * (dayOfYear - 81));
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);

  const solarTime = localMinutes + eot;
  const hourAngle = toRad(solarTime / 4 - 180);

  const latRad = toRad(lat);
  const decRad = toRad(declination);

  const sinAltitude = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude)));

  const cosAz =
    (Math.sin(decRad) - Math.sin(altitude) * Math.sin(latRad)) / (Math.cos(altitude) * Math.cos(latRad) + 1e-6);
  let azimuth = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (hourAngle > 0) azimuth = 360 - azimuth;

  const cosHour = (Math.sin(toRad(-0.833)) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHour)));
  // ha is in radians; the sun traverses 15° per hour, so full day length in
  // minutes is (2 * ha_deg) / 15 * 60 = 2 * ha * 720 / PI.
  const dayLengthMin = (2 * ha * 720) / Math.PI;
  const solarNoon = 720 - longitudeOffsetMinutes(lon) - eot;

  return {
    altitude: toDeg(altitude),
    azimuth,
    sunriseMin: solarNoon - dayLengthMin / 2,
    sunsetMin: solarNoon + dayLengthMin / 2,
  };
}

function hashNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function smoothNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hashNoise(i + seed) * 2 - 1;
  const b = hashNoise(i + 1 + seed) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

/** Weather that evolves smoothly over hours rather than jumping randomly. */
export function simulateWeather(lat: number, at: number): WeatherNow {
  const hours = at / 3600000;
  const t = hours * 0.25; // slow drift

  const seasonal = Math.cos(((at / 1000 / 86400 + 10) % 365) / 365 * 2 * Math.PI);
  const baseTemp = 16 - seasonal * 11 + Math.abs(lat) * 0.02;

  const hourOfDay = ((at / 3600000) % 24 + 24) % 24;
  const diurnal = Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI) * 4.5;

  const cloudCover = Math.max(0, Math.min(1, 0.45 + smoothNoise(t, 11) * 0.6));
  const outdoorTemp = baseTemp + diurnal - cloudCover * 2.2 + smoothNoise(t * 4, 3) * 0.8;
  const outdoorHumidity = Math.max(
    25,
    Math.min(98, 62 - diurnal * 2.4 + cloudCover * 18 + smoothNoise(t * 3, 7) * 5),
  );

  let condition: WeatherNow['condition'] = 'clear';
  if (outdoorTemp < 1 && outdoorHumidity > 82) condition = 'snow';
  else if (cloudCover > 0.72) condition = 'rain';
  else if (cloudCover > 0.45) condition = 'cloudy';
  else if (Math.abs(smoothNoise(t, 23)) > 0.55) condition = 'wind';

  const windKph = Math.max(1, 8 + smoothNoise(t * 2, 31) * 18);
  const rainMmPerHour = condition === 'rain' ? Math.max(0, smoothNoise(t * 6, 41) * 9) : 0;

  return {
    outdoorTemp: Math.round(outdoorTemp * 10) / 10,
    outdoorHumidity: Math.round(outdoorHumidity * 10) / 10,
    condition,
    cloudCover: Math.round(cloudCover * 100) / 100,
    windKph: Math.round(windKph * 10) / 10,
    uvIndex: 0,
    rainMmPerHour: Math.round(rainMmPerHour * 100) / 100,
  };
}

export function uvIndexFor(sun: SunPosition, weather: WeatherNow): number {
  if (sun.altitude <= 0) return 0;
  const base = Math.max(0, Math.sin(toRad(sun.altitude))) * 11;
  return Math.round(base * (1 - weather.cloudCover * 0.75) * 10) / 10;
}

/** Occupancy follows a believable weekday routine. */
export function simulatePresence(at: number, seed = 0): HomeContext['presence'] {
  const d = new Date(at);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dayOfWeek = d.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const jitter = (hashNoise(Math.floor(at / 3600000) + seed) - 0.5) * 0.7;

  const wake = (isWeekend ? 8.5 : 6.6) + jitter;
  const leave = (isWeekend ? 14 : 8.4) + jitter * 0.6;
  const arrive = (isWeekend ? 21.5 : 18.6) + jitter * 0.6;

  if (hour >= wake && hour < leave) {
    return { home: true, peopleHome: 2, asleep: false, awayUntil: null };
  }
  if (hour >= leave && hour < arrive) {
    return { home: false, peopleHome: 0, asleep: false, awayUntil: at + (arrive - hour) * 3600000 };
  }
  if (hour >= arrive || hour < wake) {
    return { home: true, peopleHome: 2, asleep: hour < wake || hour >= 23.4, awayUntil: null };
  }
  return { home: true, peopleHome: 1, asleep: false, awayUntil: null };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function round0(v: number): number {
  return Math.round(v);
}