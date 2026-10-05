import { all } from './db.ts';
import { energyRange, listDevices } from './store.ts';
import type { ParsedDevice } from './types.ts';
import { CATEGORY } from './sim/devices.ts';
import { round1, round2 } from './lib/math.ts';

export interface EnergyBucket {
  label: string;
  startMinute: number;
  kwh: number;
  cost: number;
  avgWatts: number;
}

export interface EnergyReport {
  currency: string;
  ratePerKwh: number;
  now: number;
  today: { kwh: number; cost: number; avgWatts: number; peakWatts: number; peakAt: number | null; vsYesterdayPct: number };
  yesterday: { kwh: number; cost: number };
  month: { kwh: number; cost: number; projectedKwh: number; projectedCost: number };
  byCategory: Array<{ category: string; kwh: number; cost: number; pct: number }>;
  hourly: EnergyBucket[];
  byRoom: Array<{ room: string; kwh: number; cost: number; pct: number }>;
  weekOverWeekPct: number;
  topConsumers: Array<{ id: string; name: string; kind: string; kwh: number; cost: number }>;
}

function bucketise(samples: Array<{ minute: number; watts: number }>, rate: number, minutesPerBucket: number, nowMinute: number): EnergyBucket[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.minute / minutesPerBucket) * minutesPerBucket;
    const entry = buckets.get(key) ?? { sum: 0, n: 0 };
    entry.sum += s.watts;
    entry.n += 1;
    buckets.set(key, entry);
  }
  const out: EnergyBucket[] = [];
  for (const [startMinute, { sum, n }] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const avgWatts = sum / Math.max(1, n);
    const kwh = (avgWatts * minutesPerBucket) / 60 / 1000;
    out.push({
      label: bucketLabel(startMinute, minutesPerBucket),
      startMinute,
      kwh: round2(kwh),
      cost: round2(kwh * rate),
      avgWatts: round1(avgWatts),
    });
  }
  return out;
}

function bucketLabel(startMinute: number, minutesPerBucket: number): string {
  const d = new Date(startMinute * 60000);
  if (minutesPerBucket >= 1440) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (minutesPerBucket >= 60) return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function buildEnergyReport(homeId: string, ratePerKwh: number, currency: string): EnergyReport {
  const now = Date.now();
  const nowMinute = Math.floor(now / 60000);
  const startOfDay = nowMinute - ((nowMinute % 1440) + 1440) % 1440;
  const since = nowMinute - 60 * 24 * 7;

  const samples = energyRange(homeId, since);
  const today = samples.filter((s) => s.minute >= startOfDay);
  const yesterday = samples.filter((s) => s.minute >= startOfDay - 1440 && s.minute < startOfDay);
  const week = samples.filter((s) => s.minute >= startOfDay - 6 * 1440);
  const prevWeek = samples.filter((s) => s.minute >= startOfDay - 13 * 1440 && s.minute < startOfDay - 6 * 1440);

  // Each stored sample already represents one simulated minute of draw.
  const kwhOf = (rows: Array<{ minute: number; watts: number }>) =>
    round2(rows.reduce((acc, r) => acc + r.watts / 1000 / 60, 0));

  const todayKwh = kwhOf(today);
  const yesterdayKwhAdj = kwhOf(yesterday);

  const avgWatts = today.length ? round1(today.reduce((a, r) => a + r.watts, 0) / today.length) : 0;
  let peak = { watts: 0, at: null as number | null };
  for (const s of today) if (s.watts > peak.watts) peak = { watts: s.watts, at: s.minute * 60000 };

  const monthSamples = samples;
  const monthKwh = monthSamples.reduce((acc, r) => acc + r.watts / 1000 / 60, 0);
  const elapsedDays = Math.max(1, (nowMinute - startOfDay) / 1440);
  const projectedKwh = round2((todayKwh / elapsedDays) * 30);

  const devices = listDevices(homeId);
  const rooms = all<{ id: string; name: string }>('SELECT id, name FROM rooms WHERE home_id = ?', homeId);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  /**
   * Categories and rooms are attributed from the measured draw each device is
   * pulling right now, scaled across the measured window. That keeps the
   * breakdown consistent with the headline kWh figure instead of being skewed
   * by one device's lifetime counter.
   */
  const weekKwh = samples.reduce((acc, r) => acc + r.watts / 1000 / 60, 0);
  const liveShares = devices.map((d) => ({
    device: d,
    watts: d.state.powerWatts ?? 0,
    category: CATEGORY[d.kind] ?? 'Other',
    room: d.room_id ? (roomName.get(d.room_id) ?? 'Unassigned') : 'Unassigned',
  }));
  const totalLiveWatts = liveShares.reduce((a, d) => a + d.watts, 0);

  const catMap = new Map<string, number>();
  const roomMap = new Map<string, number>();
  const topConsumers: Array<{ id: string; name: string; kind: string; kwh: number; cost: number }> = [];

  if (totalLiveWatts > 0) {
    for (const s of liveShares) {
      const share = (s.watts / totalLiveWatts) * weekKwh;
      if (share <= 0) continue;
      catMap.set(s.category, (catMap.get(s.category) ?? 0) + share);
      roomMap.set(s.room, (roomMap.get(s.room) ?? 0) + share);
      if (s.watts >= 5) {
        topConsumers.push({ id: s.device.id, name: s.device.name, kind: s.device.kind, kwh: round2(share), cost: round2(share * ratePerKwh) });
      }
    }
  }

  const catTotal = [...catMap.values()].reduce((a, b) => a + b, 0) || 1;
  const roomTotal = [...roomMap.values()].reduce((a, b) => a + b, 0) || 1;

  const prevWeekKwh = prevWeek.reduce((a, r) => a + r.watts / 1000 / 60, 0);
  const recentWeekKwh = week.reduce((a, r) => a + r.watts / 1000 / 60, 0);

  return {
    currency,
    ratePerKwh,
    now,
    today: {
      kwh: todayKwh,
      cost: round2(todayKwh * ratePerKwh),
      avgWatts,
      peakWatts: round1(peak.watts),
      peakAt: peak.at,
      vsYesterdayPct: yesterdayKwhAdj > 0 ? round1(((todayKwh - yesterdayKwhAdj) / yesterdayKwhAdj) * 100) : 0,
    },
    yesterday: { kwh: yesterdayKwhAdj, cost: round2(yesterdayKwhAdj * ratePerKwh) },
    month: {
      kwh: round2(monthKwh),
      cost: round2(monthKwh * ratePerKwh),
      projectedKwh,
      projectedCost: round2(projectedKwh * ratePerKwh),
    },
    byCategory: [...catMap.entries()]
      .map(([category, kwh]) => ({
        category,
        kwh: round2(kwh),
        cost: round2(kwh * ratePerKwh),
        pct: round1((kwh / catTotal) * 100),
      }))
      .sort((a, b) => b.kwh - a.kwh),
    hourly: bucketise(today, ratePerKwh, 60, nowMinute),
    byRoom: [...roomMap.entries()]
      .map(([room, kwh]) => ({
        room,
        kwh: round2(kwh),
        cost: round2(kwh * ratePerKwh),
        pct: round1((kwh / roomTotal) * 100),
      }))
      .sort((a, b) => b.kwh - a.kwh),
    weekOverWeekPct: prevWeekKwh > 0 ? round1(((recentWeekKwh - prevWeekKwh) / prevWeekKwh) * 100) : 0,
    topConsumers: topConsumers.sort((a, b) => b.kwh - a.kwh).slice(0, 6),
  };
}

export interface Insight {
  id: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  savingsKwh?: number;
  deviceId?: string;
}

/** Rule-based anomaly detection over live state + recent history. */
export function buildInsights(homeId: string, devices: ParsedDevice[], report: EnergyReport, currency: string): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // Standby loads
  const standby = devices.filter((d) => (d.state.powerWatts ?? 0) >= 5 && d.state.power === 'standby');
  if (standby.length > 0) {
    const totalW = standby.reduce((a, d) => a + (d.state.powerWatts ?? 0), 0);
    insights.push({
      id: 'standby',
      severity: 'warning',
      title: `${standby.length} device${standby.length > 1 ? 's are' : ' is'} idling at ${Math.round(totalW)} W`,
      body: `${standby.map((d) => d.name).join(', ')} never fully power down. That is roughly ${round2((totalW * 24 * 30) / 1000)} kWh a month (${currencySymbol(currency)}${round2(((totalW * 24 * 30) / 1000) * report.ratePerKwh)}).`,
      savingsKwh: round2((totalW * 24 * 30) / 1000),
    });
  }

  // Low batteries
  const lowBattery = devices.filter((d) => (d.state.battery ?? 100) < 25 && d.state.battery !== undefined);
  if (lowBattery.length) {
    insights.push({
      id: 'battery',
      severity: 'warning',
      title: `${lowBattery.length} sensor${lowBattery.length > 1 ? 's need' : ' needs'} attention`,
      body: `${lowBattery.map((d) => `${d.name} (${Math.round(d.state.battery ?? 0)}%)`).join(', ')}. Below 10% they stop reporting.`,
    });
  }

  // Air quality
  const air = devices.find((d) => d.kind === 'air_quality');
  if (air?.state.co2 && air.state.co2 > 900) {
    insights.push({
      id: 'co2',
      severity: air.state.co2 > 1400 ? 'critical' : 'warning',
      title: `CO₂ at ${air.state.co2} ppm in the ${air.name}'s room`,
      body: 'Above 900 ppm cognitive performance starts to drop. Opening a window or running the purifier clears it in minutes.',
      deviceId: air.id,
    });
  }
  if (air?.state.pm25 && air.state.pm25 > 25) {
    insights.push({
      id: 'pm25',
      severity: 'warning',
      title: `Particulate matter at ${air.state.pm25} µg/m³`,
      body: 'Above the WHO daily guideline. Consider running the air purifier on high.',
      deviceId: air.id,
    });
  }

  // Leak
  const leak = devices.find((d) => d.state.leak);
  if (leak) {
    insights.push({ id: 'leak', severity: 'critical', title: `Water leak detected at ${leak.name}`, body: 'The main valve has been closed and cameras are recording.', deviceId: leak.id });
  }

  // Security posture
  const unlocked = devices.filter((d) => d.kind === 'lock' && d.state.locked === false);
  const openContacts = devices.filter((d) => d.kind === 'sensor_contact' && d.state.open);
  if (unlocked.length || openContacts.length) {
    insights.push({
      id: 'security',
      severity: 'warning',
      title: 'Home is not fully secured',
      body: [...unlocked.map((d) => `${d.name} unlocked`), ...openContacts.map((d) => `${d.name} open`)].join(', ') + '.',
    });
  }

  // HVAC optimisation
  const stats = devices.filter((d) => d.kind === 'thermostat');
  const indoor = stats.map((d) => d.state.temperature ?? 21);
  const avgIndoor = indoor.length ? indoor.reduce((a, b) => a + b, 0) / indoor.length : 21;
  if (avgIndoor > 22.5) {
    insights.push({
      id: 'hvac',
      severity: 'info',
      title: `Indoor temperature is ${round1(avgIndoor)}°C`,
      body: 'Dropping the target by 1.5°C is typically unnoticeable and cuts heating demand by 6-8%.',
      savingsKwh: round2(report.today.kwh * 0.07),
    });
  }

  // Trend
  if (report.today.vsYesterdayPct > 15) {
    insights.push({
      id: 'trend-up',
      severity: 'warning',
      title: `Using ${Math.round(report.today.vsYesterdayPct)}% more than yesterday`,
      body: `Yesterday finished at ${report.yesterday.kwh} kWh. Today is tracking to ${report.today.kwh} kWh.`,
    });
  } else if (report.today.vsYesterdayPct < -10) {
    insights.push({
      id: 'trend-down',
      severity: 'success',
      title: `Down ${Math.abs(Math.round(report.today.vsYesterdayPct))}% versus yesterday`,
      body: 'Nice work. Today is tracking at ' + report.today.kwh + ' kWh.',
    });
  }

  // Peak shifting
  if (report.today.peakAt && report.ratePerKwh > 0) {
    const hour = new Date(report.today.peakAt).getHours();
    if ((hour >= 16 && hour < 21) || (hour >= 7 && hour < 9)) {
      insights.push({
        id: 'peak',
        severity: 'info',
        title: 'Your peak draw lands during an expensive tariff window',
        body: `Highest draw was ${report.today.peakWatts} W at ${hour}:00. Running the dishwasher or EV charging after 23:00 usually costs noticeably less.`,
        savingsKwh: round2(report.today.kwh * 0.12),
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2, success: 3 } as const;
  return insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 8);
}

export function currencySymbol(code: string): string {
  return code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code === 'INR' ? '₹' : '';
}