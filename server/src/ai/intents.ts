import type { CommandResult } from '../automation.ts';

/**
 * Local intent engine. Zero network calls, zero cost, deterministic.
 * It tokenizes the utterance, scores candidate intents, extracts entities
 * (room, device kind, colour, level, temperature, scene) and returns a plan
 * the API executes for real.
 */

export type IntentName =
  | 'device.turn_on'
  | 'device.turn_off'
  | 'device.toggle'
  | 'device.set_brightness'
  | 'device.set_volume'
  | 'device.set_temperature'
  | 'device.set_level'
  | 'device.lock'
  | 'device.unlock'
  | 'device.set_position'
  | 'media.play'
  | 'media.pause'
  | 'scene.activate'
  | 'energy.report'
  | 'energy.explain'
  | 'security.status'
  | 'home.status'
  | 'home.what_is_on'
  | 'automation.create'
  | 'insights.summary'
  | 'help'
  | 'smalltalk'
  | 'unknown';

export interface Entity {
  type: 'room' | 'kind' | 'color' | 'number' | 'temperature' | 'scene' | 'percent' | 'name' | 'time';
  value: string;
  raw?: string;
}

export interface IntentPlan {
  intent: IntentName;
  confidence: number;
  entities: Entity[];
  command?: string;
  args?: Record<string, unknown>;
  target?: { deviceId?: string; deviceKind?: string; sceneId?: string };
  reply: string;
  /** true when the plan mutates the home */
  mutating: boolean;
  needsClarification?: string;
}

const KIND_WORDS: Record<string, string> = {
  light: 'light',
  lights: 'light',
  lamp: 'light',
  lamps: 'light',
  bulb: 'light',
  bulbs: 'light',
  'ceiling light': 'light',
  thermostat: 'thermostat',
  heating: 'thermostat',
  ac: 'thermostat',
  'air conditioner': 'thermostat',
  temperature: 'thermostat',
  lock: 'lock',
  locks: 'lock',
  door: 'lock',
  doorbell: 'doorbell',
  camera: 'camera',
  cameras: 'camera',
  cctv: 'camera',
  motion: 'sensor_motion',
  'motion sensor': 'sensor_motion',
  sensor: 'sensor_motion',
  leak: 'sensor_leak',
  'leak sensor': 'sensor_leak',
  water: 'sensor_leak',
  window: 'sensor_contact',
  contact: 'sensor_contact',
  plug: 'plug',
  socket: 'plug',
  'power outlet': 'plug',
  speaker: 'speaker',
  speakers: 'speaker',
  sound: 'speaker',
  music: 'speaker',
  tv: 'tv',
  television: 'tv',
  blinds: 'blinds',
  blind: 'blinds',
  curtain: 'blinds',
  curtains: 'blinds',
  shades: 'blinds',
  fan: 'fan',
  'air quality': 'air_quality',
  'air quality monitor': 'air_quality',
  vacuum: 'vacuum',
  'robot vacuum': 'vacuum',
  cleaner: 'vacuum',
  roombа: 'vacuum',
  garage: 'garage',
};

const COLORS: Record<string, string> = {
  red: 'red',
  crimson: 'red',
  orange: 'orange',
  amber: 'amber',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  violet: 'purple',
  pink: 'pink',
  white: 'white',
  warm: 'warm',
  cool: 'cool',
};

const SCENE_WORDS: Record<string, string[]> = {
  movie: ['movie', 'film', 'cinema', 'watch a movie'],
  'movie night': ['movie night', 'film night'],
  morning: ['good morning', 'morning', 'wake up', 'goodmorning'],
  night: ['good night', 'goodnight', 'bedtime', 'sleep', 'go to bed'],
  away: ['away', 'leaving', 'i am leaving', 'vacation', 'holiday'],
  home: ['i am home', 'im home', 'home', 'arriving'],
  focus: ['focus', 'work', 'study', 'working'],
  relax: ['relax', 'unwind', 'chill', 'calm'],
  party: ['party', 'guests', 'dinner party'],
  cleaning: ['cleaning', 'clean up', 'tidy'],
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  full: 100, off_: 0, half: 50, quarter: 25,
};

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\w\s.%-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function has(text: string, ...phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

function extractNumber(text: string): number | null {
  const pct = text.match(/(\d{1,3})\s*(?:%|percent|per ?cent)/);
  if (pct) return clampNum(Number(pct[1]), 0, 100);
  const deg = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:degrees?|deg|c\b|celsius)/);
  if (deg) return clampNum(Number(deg[1]), 5, 32);
  const plain = text.match(/\b(\d{1,3}(?:\.\d+)?)\b/);
  if (plain) {
    const v = Number(plain[1]);
    if (v >= 0 && v <= 100) return v;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface RoomIndex {
  id: string;
  name: string;
  kind: string;
}

export interface DeviceIndexItem {
  id: string;
  name: string;
  kind: string;
  room_id: string | null;
  roomName: string | null;
  power: string;
}

export interface EngineContext {
  rooms: RoomIndex[];
  devices: DeviceIndexItem[];
  scenes: Array<{ id: string; name: string }>;
  energyTodayKwh: number;
  energyCostToday: number;
  totalDevicesOn: number;
  securityIssues: string[];
  presenceHome: boolean;
  localTime: string;
  outdoorTemp: number;
  weatherCondition: string;
  indoorAvgTemp: number;
  currency: string;
}

export function parseIntent(rawText: string, ctx: EngineContext): IntentPlan {
  const text = normalise(rawText);
  const entities: Entity[] = [];

  // Entities
  const room = ctx.rooms.find((r) => text.includes(` ${r.name.toLowerCase()} `));
  if (room) entities.push({ type: 'room', value: room.id, raw: room.name });

  let kind: string | null = null;
  let bestKindLen = 0;
  for (const [word, mapped] of Object.entries(KIND_WORDS)) {
    if (text.includes(` ${word} `) && word.length > bestKindLen) {
      kind = mapped;
      bestKindLen = word.length;
    }
  }
  if (kind) entities.push({ type: 'kind', value: kind });

  let color: string | null = null;
  for (const [word, mapped] of Object.entries(COLORS)) {
    if (text.includes(` ${word} `)) {
      color = mapped;
      entities.push({ type: 'color', value: mapped, raw: word });
      break;
    }
  }

  let scene: { id: string; name: string } | null = null;
  for (const [name, phrases] of Object.entries(SCENE_WORDS)) {
    if (phrases.some((p) => text.includes(p))) {
      const match = ctx.scenes.find((s) => s.name.toLowerCase().includes(name));
      if (match) scene = match;
      else scene = { id: name, name: name.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) };
      entities.push({ type: 'scene', value: scene.id, raw: name });
      break;
    }
  }

  const number = extractNumber(text);
  const degree = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:degrees?|deg|celsius|c\b)/);
  if (degree) entities.push({ type: 'temperature', value: String(clampNum(Number(degree[1]), 5, 32)) });

  const targets = () => {
    const byId = room ? ctx.devices.filter((d) => d.room_id === room.id) : ctx.devices;
    if (kind) return byId.filter((d) => d.kind === kind);
    return byId;
  };
  const targetList = targets();

  // ---- Scenes -----------------------------------------------------------
  if (scene && has(text, 'activate', 'start', 'run', 'set the mood', 'turn on', 'begin', 'go')) {
    const wantsOff = has(text, 'off', 'disable', 'stop', 'end', 'cancel');
    if (wantsOff) {
      return plan('scene.activate', 0.7, entities, 'noted', undefined, undefined, {
        reply: `Ending ${scene.name}.`,
        mutating: true,
      });
    }
    return plan('scene.activate', 0.93, entities, 'activateScene', { sceneId: scene.id }, { sceneId: scene.id }, {
      reply: `Activating ${scene.name}.`,
      mutating: true,
    });
  }

  // ---- Energy / insights (read-only) -----------------------------------
  if (has(text, 'energy', 'power usage', 'electricity', 'bill', 'kwh', 'watts', 'how much am i using', 'consumption')) {
    if (has(text, 'why', 'explain', 'reason', 'because', 'cause', 'what caused')) {
      return plan('energy.explain', 0.88, entities, 'energyExplain', undefined, undefined, {
        reply: 'Analysing your consumption patterns.',
        mutating: false,
      });
    }
    return plan('energy.report', 0.9, entities, 'energyReport', undefined, undefined, {
      reply: 'Pulling up your energy data.',
      mutating: false,
    });
  }

  if (has(text, 'secure', 'security', 'burglar', 'intruder', 'lock down', 'safe')) {
    return plan('security.status', 0.85, entities, 'securityStatus', undefined, undefined, {
      reply: 'Checking doors, locks and sensors.',
      mutating: false,
    });
  }

  if (has(text, 'motion', 'anyone home', 'is someone there', 'movement')) {
    return plan('home.status', 0.7, entities, 'homeStatus', undefined, undefined, {
      reply: 'Checking motion sensors.',
      mutating: false,
    });
  }

  if (has(text, "what's on", 'whats on', 'what is on', 'anything on', 'which devices are on', 'status of', 'summary', 'overview', 'how is')) {
    return plan('home.what_is_on', 0.86, entities, 'whatIsOn', undefined, undefined, {
      reply: 'Checking what is currently running.',
      mutating: false,
    });
  }

  if (has(text, 'insight', 'advice', 'recommend', 'suggest', 'improve', 'optimi', 'save money', 'reduce', 'any issue', 'problem', 'wrong', 'diagnos')) {
    return plan('insights.summary', 0.82, entities, 'insights', undefined, undefined, {
      reply: 'Reviewing your home for issues and savings opportunities.',
      mutating: false,
    });
  }

  if (has(text, 'automation', 'routine', 'schedule', 'rule') && has(text, 'create', 'add', 'new', 'make', 'set up', 'setup')) {
    return plan('automation.create', 0.8, entities, 'automationDraft', undefined, undefined, {
      reply: 'Drafting an automation from that description.',
      mutating: false,
    });
  }

  if (has(text, 'help', 'what can you do', 'commands', 'how do i')) {
    return plan('help', 0.95, entities, 'help', undefined, undefined, {
      reply: 'Here is what I can do.',
      mutating: false,
    });
  }

  if (has(text, 'hello', 'hi ', 'hey', 'good morning', 'good evening', 'thanks', 'thank you')) {
    return plan('smalltalk', 0.6, entities, 'smalltalk', undefined, undefined, {
      reply: `Hello. ${ctx.presenceHome ? 'Welcome home.' : 'Your home is secure while you are away.'}`,
      mutating: false,
    });
  }

  // ---- Media ------------------------------------------------------------
  if (kind === 'speaker' || kind === 'tv') {
    if (has(text, 'pause', 'stop playing', 'silence', 'mute', 'shut up', 'hush')) {
      return plan('media.pause', 0.92, entities, 'pause', undefined, { deviceKind: kind }, {
        reply: 'Pausing playback.',
        mutating: true,
      });
    }
    if (has(text, 'play', 'resume', 'listen', 'watch', 'put on', 'start music')) {
      const what = text.match(/(?:play|listen to|put on|watch)\s+([a-z0-9\s'-]{2,40})/);
      return plan('media.play', 0.85, entities, 'setPlaying', { value: what ? what[1].trim() : 'playlist' }, { deviceKind: kind }, {
        reply: `Playing ${what ? what[1].trim() : 'your playlist'}.`,
        mutating: true,
      });
    }
  }

  // ---- Locks ------------------------------------------------------------
  if (kind === 'lock' || (has(text, 'lock', 'unlock') && !has(text, 'deadbolt'))) {
    if (has(text, 'unlock', 'open up')) {
      return plan('device.unlock', 0.9, entities, 'unlock', undefined, { deviceKind: 'lock' }, {
        reply: 'Unlocking doors.',
        mutating: true,
      });
    }
    if (has(text, 'lock', 'secure')) {
      return plan('device.lock', 0.9, entities, 'lock', undefined, { deviceKind: 'lock' }, {
        reply: 'Locking up.',
        mutating: true,
      });
    }
  }

  // ---- Blinds -----------------------------------------------------------
  if (kind === 'blinds') {
    const value = number ?? (has(text, 'open', 'raise') ? 100 : 0);
    return plan('device.set_position', 0.85, entities, 'setPosition', { value }, { deviceKind: 'blinds' }, {
      reply: `Setting blinds to ${value}%.`,
      mutating: true,
    });
  }

  // ---- Thermostat -------------------------------------------------------
  if (kind === 'thermostat' || (degree && has(text, 'temperature', 'thermostat', 'heating', 'cool'))) {
    if (has(text, 'off', 'eco', 'away')) {
      return plan('device.turn_off', 0.85, entities, 'setMode', { value: 'off' }, { deviceKind: 'thermostat' }, {
        reply: 'Turning the thermostat off.',
        mutating: true,
      });
    }
    const target = degree ? clampNum(Number(degree[1]), 5, 32) : number !== null ? clampNum(number, 5, 32) : null;
    if (target !== null) {
      return plan('device.set_temperature', 0.92, entities, 'setTargetTemperature', { value: target }, { deviceKind: 'thermostat' }, {
        reply: `Setting the temperature to ${target}°C.`,
        mutating: true,
      });
    }
  }

  // ---- Brightness / volume / level --------------------------------------
  if (has(text, 'brightness', 'bright', 'dim', 'dimm')) {
    const value = number ?? 50;
    return plan('device.set_brightness', 0.88, entities, 'setBrightness', { value }, { deviceKind: 'light' }, {
      reply: `Setting lights to ${value}%.`,
      mutating: true,
    });
  }
  if (has(text, 'volume', 'loud', 'louder', 'quieter', 'quiet', 'sound level')) {
    const value = number ?? 35;
    return plan('device.set_volume', 0.85, entities, 'setVolume', { value }, { deviceKind: 'speaker' }, {
      reply: `Setting volume to ${value}%.`,
      mutating: true,
    });
  }
  if (kind === 'fan' && has(text, 'speed', 'fan speed', 'level')) {
    const value = number ?? 50;
    return plan('device.set_level', 0.82, entities, 'setLevel', { value }, { deviceKind: 'fan' }, {
      reply: `Setting fan speed to ${value}%.`,
      mutating: true,
    });
  }

  // ---- Vacuum -----------------------------------------------------------
  if (kind === 'vacuum') {
    if (has(text, 'dock', 'stop', 'pause', 'charge', 'home')) {
      return plan('device.turn_off', 0.82, entities, 'dock', undefined, { deviceKind: 'vacuum' }, {
        reply: 'Returning the vacuum to its dock.',
        mutating: true,
      });
    }
    return plan('device.turn_on', 0.82, entities, 'vacuumStart', undefined, { deviceKind: 'vacuum' }, {
      reply: 'Starting a clean.',
      mutating: true,
    });
  }

  // ---- On / off / toggle -------------------------------------------------
  const wantsOff = has(text, 'turn off', 'switch off', 'shut off', 'kill', 'disable', 'stop', 'extinguish', 'put out');
  const wantsOn = has(text, 'turn on', 'switch on', 'power on', 'start', 'activate', 'enable', 'light up', 'illuminate');
  const wantsToggle = has(text, 'toggle', 'flip', 'switch');

  if (kind && (wantsOff || wantsOn || wantsToggle)) {
    const command = wantsOff ? 'turnOff' : wantsOn ? 'turnOn' : 'toggle';
    const scope = has(text, ' all ', ' everything ', ' every ') && !room ? { deviceKind: kind } : room ? { deviceId: roomDeviceId(ctx, room.id, kind) ?? undefined, deviceKind: kind } : { deviceKind: kind };
    const label = describeScope(ctx, room, kind);
    return plan(
      wantsOff ? 'device.turn_off' : wantsOn ? 'device.turn_on' : 'device.toggle',
      targetList.length ? 0.9 : 0.55,
      entities,
      command,
      {},
      scope,
      {
        reply:
          wantsOff
            ? `Turning off ${label}.`
            : wantsOn
              ? `Turning on ${label}.`
              : `Toggling ${label}.`,
        mutating: true,
        needsClarification: targetList.length === 0 ? `I couldn't find ${label}.` : undefined,
      },
    );
  }

  if (!kind && (wantsOn || wantsOff || wantsToggle)) {
    if (scene) {
      return plan('scene.activate', 0.7, entities, 'activateScene', { sceneId: scene.id }, { sceneId: scene.id }, {
        reply: `Activating ${scene.name}.`,
        mutating: true,
      });
    }
    if (room) {
      const command = wantsOff ? 'turnOff' : wantsOn ? 'turnOn' : 'toggle';
      return plan(wantsOff ? 'device.turn_off' : 'device.turn_on', 0.6, entities, command, {}, { roomId: room.id }, {
        reply: `${wantsOff ? 'Turning off' : 'Turning on'} everything in the ${room.name}.`,
        mutating: true,
      });
    }
    return plan('home.status', 0.4, entities, 'homeStatus', undefined, undefined, {
      reply: 'Which device did you mean? Try naming a room, like "turn off the living room lights".',
      mutating: false,
      needsClarification: 'Which device?',
    });
  }

  return plan('unknown', 0.2, entities, undefined, undefined, undefined, {
    reply: "I didn't catch that. Try \"set the living room lights to 40%\", \"lock the doors\", or \"how much energy am I using?\"",
    mutating: false,
    needsClarification: 'Try rephrasing.',
  });
}

function roomDeviceId(ctx: EngineContext, roomId: string, kind: string): string | null {
  return ctx.devices.find((d) => d.room_id === roomId && d.kind === kind)?.id ?? null;
}

function describeScope(ctx: EngineContext, room: RoomIndex | undefined, kind: string | null): string {
  const kindLabel =
    kind === 'light'
      ? 'the lights'
      : kind
        ? `the ${kind.replace(/_/g, ' ')}`
        : 'the devices';
  return room ? `${kindLabel} in the ${room.name}` : kindLabel;
}

function plan(
  intent: IntentName,
  confidence: number,
  entities: Entity[],
  command: string | undefined,
  args: Record<string, unknown> | undefined,
  target: { deviceId?: string; deviceKind?: string; roomId?: string; sceneId?: string } | undefined,
  extra: { reply: string; mutating: boolean; needsClarification?: string },
): IntentPlan {
  return { intent, confidence, entities, command, args, target, ...extra };
}

export const SUGGESTIONS = [
  'Set a movie night scene',
  'Why is my energy bill high?',
  'Lock all the doors',
  'Set the living room lights to 35%',
  'Turn the thermostat down to 19',
  'Is my home secure?',
  'Start the vacuum',
  'What is on right now?',
  'Set bedroom blinds to 20%',
];

/**
 * Optional free-tier LLM upgrade. If SL_LLM_URL is set we ask the model to map
 * the utterance to the same JSON plan shape; otherwise the local engine wins.
 */
export async function planViaLlm(rawText: string, ctx: EngineContext, local: IntentPlan): Promise<IntentPlan> {
  const url = process.env.SL_LLM_URL;
  const key = process.env.SL_LLM_KEY;
  if (!url || !key) return local;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.SL_LLM_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You convert smart-home commands into JSON. Reply with only: {"intent":one of ' +
              'device.turn_on|device.turn_off|device.toggle|device.set_brightness|device.set_volume|' +
              'device.set_temperature|device.lock|device.unlock|scene.activate|energy.report|' +
              'security.status|home.what_is_on|insights.summary|unknown,"command":string|null,' +
              '"value":number|null,"deviceKind":string|null,"roomId":string|null}.',
          },
          {
            role: 'user',
            content: `Rooms: ${ctx.rooms.map((r) => `${r.name}(${r.id})`).join(', ')}. Devices: ${ctx.devices
              .map((d) => `${d.name}[${d.kind}]`)
              .join(', ')}. Scenes: ${ctx.scenes.map((s) => s.name).join(', ')}. Command: "${rawText}"`,
          },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return local;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return local;
    const parsed = JSON.parse(content) as {
      intent: IntentName;
      command?: string | null;
      value?: number | null;
      deviceKind?: string | null;
      roomId?: string | null;
    };
    if (!parsed.intent) return local;

    const target: { deviceId?: string; deviceKind?: string } = {};
    if (parsed.deviceKind) target.deviceKind = parsed.deviceKind;
    if (parsed.roomId) {
      const d = ctx.devices.find((x) => x.room_id === parsed.roomId && (!parsed.deviceKind || x.kind === parsed.deviceKind));
      if (d) target.deviceId = d.id;
    }
    return {
      intent: parsed.intent,
      confidence: 0.95,
      entities: [],
      command: parsed.command ?? undefined,
      args: parsed.value != null ? { value: parsed.value } : {},
      target: Object.keys(target).length ? target : undefined,
      reply: local.reply,
      mutating: local.mutating,
    };
  } catch {
    return local;
  }
}

export function summariseResults(results: CommandResult[]): string {
  const ok = results.filter((r) => r.ok);
  if (ok.length === 0) return 'I could not complete that.';
  const first = ok[0];
  if (ok.length === 1) return `${first.name} ${first.message}.`;
  return `${first.name} ${first.message}, plus ${ok.length - 1} more device${ok.length - 2 === 1 ? '' : 's'} updated.`;
}