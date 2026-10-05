/**
 * Simulated clock.
 *
 * The whole home runs on this clock rather than wall time so that a full
 * day/night cycle, occupancy routine and battery drain can be observed in a
 * couple of minutes instead of a full day. The scale factor is runtime
 * adjustable from the app.
 */

const REAL_ORIGIN = Date.now();
const SIM_ORIGIN = Date.now();

let scale = clampScale(Number(process.env.SL_TIME_SCALE ?? 60));

function clampScale(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 60;
  return Math.max(1, Math.min(600, Math.round(v)));
}

/** Current simulated time in epoch milliseconds. */
export function simNow(): number {
  return SIM_ORIGIN + (Date.now() - REAL_ORIGIN) * scale;
}

/** Real wall-clock time, for things that must not drift (auth, logs). */
export function realNow(): number {
  return Date.now();
}

/** Simulated seconds that elapse per real second. */
export function timeScale(): number {
  return scale;
}

export function setTimeScale(next: number): number {
  scale = clampScale(next);
  return scale;
}

/** Local minutes-of-day for a longitude. */
export function localMinutesFor(lon: number, at: number): number {
  const utcMinutes = ((at / 60000) % 1440 + 1440) % 1440;
  return (utcMinutes + (lon / 15) * 60 + 1440) % 1440;
}