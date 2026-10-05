/**
 * End-to-end smoke test that mirrors exactly what the mobile client does.
 */
import WebSocket from '/home/bal/smart_home_app/mobile/node_modules/ws/index.js';

const BASE = 'http://localhost:4000';
let token = '';
let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

console.log('\n== auth ==');
{
  const bad = await call('/api/auth/login', { method: 'POST', body: { email: 'demo@smartliving.app', password: 'wrong' } });
  ok('rejects bad password', bad.status === 401, `got ${bad.status}`);

  const res = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'demo@smartliving.app', password: 'demo1234' },
  });
  ok('login returns token', typeof res.data?.token === 'string' && res.data.token.length > 20);
  token = res.data.token;

  const me = await call('/api/me');
  ok('/api/me returns user+home', Boolean(me.data?.user?.email && me.data?.home?.id));
}

console.log('\n== read endpoints the app calls ==');
let devices = [];
let scenes = [];
let homeId = '';
{
  const home = await call('/api/home');
  homeId = home.data?.home?.id ?? '';
  ok('/api/home has rooms', Array.isArray(home.data?.rooms) && home.data.rooms.length >= 7);
  ok('/api/home has presence', typeof home.data?.presence?.home === 'boolean');
  ok('/api/home has power.byCategory', typeof home.data?.power?.byCategory === 'object');
  ok('/api/home has counts', typeof home.data?.counts?.total === 'number');
  ok('/api/home sun altitude is finite', Number.isFinite(home.data?.sun?.altitude));
  ok('/api/home sunrise before sunset', (home.data?.sun?.sunsetMin ?? 0) - (home.data?.sun?.sunriseMin ?? 0) > 120);

  const d = await call('/api/devices');
  devices = d.data?.devices ?? [];
  ok('/api/devices returns array', devices.length > 20, `got ${devices.length}`);
  ok('device has placement.x/z', devices.every((x) => Number.isFinite(x.placement?.x) && Number.isFinite(x.placement?.z)));
  ok('device has roomName', devices.some((x) => typeof x.roomName === 'string'));

  const s = await call('/api/scenes');
  scenes = s.data?.scenes ?? [];
  ok('/api/scenes returns array', scenes.length >= 6);
  ok('scene icon is a slug string', scenes.every((x) => typeof x.icon === 'string'));

  const a = await call('/api/automations');
  ok('/api/automations returns array', (a.data?.automations ?? []).length >= 6);
  ok('automation trigger has kind+op+value', (a.data?.automations ?? []).every((x) => x.trigger?.kind && x.trigger?.op));

  const e = await call('/api/energy');
  ok('/api/energy today.kwh number', Number.isFinite(e.data?.today?.kwh));
  ok('/api/energy hourly buckets', Array.isArray(e.data?.hourly) && e.data.hourly.length > 0);
  ok('/api/energy byCategory', Array.isArray(e.data?.byCategory) && e.data.byCategory.length > 0);

  const i = await call('/api/insights');
  ok('/api/insights returns array', Array.isArray(i.data?.insights));

  const ev = await call('/api/events');
  ok('/api/events returns array', Array.isArray(ev.data?.events));

  const hist = await call('/api/ai/history');
  ok('/api/ai/history suggestions', Array.isArray(hist.data?.suggestions) && hist.data.suggestions.length > 0);

  const sim = await call('/api/sim');
  ok('/api/sim has scale/localTime', Number.isFinite(sim.data?.scale) && typeof sim.data?.localTime === 'string');
}

console.log('\n== device commands (args.value contract) ==');
{
  const light = devices.find((d) => d.kind === 'light');
  let res = await call(`/api/devices/${light.id}/command`, { method: 'POST', body: { command: 'setBrightness', args: { value: 70 } } });
  ok('setBrightness {value:70}', res.data?.device?.state?.brightness === 70, JSON.stringify(res.data?.device?.state));

  res = await call(`/api/devices/${light.id}/command`, { method: 'POST', body: { command: 'toggle' } });
  ok('toggle flips power', res.data?.device?.state?.power === 'off', JSON.stringify(res.data?.device?.state));

  const thermo = devices.find((d) => d.kind === 'thermostat');
  res = await call(`/api/devices/${thermo.id}/command`, { method: 'POST', body: { command: 'setTargetTemperature', args: { value: 22.5 } } });
  ok('setTargetTemperature {value:22.5}', res.data?.device?.state?.targetTemperature === 22.5, JSON.stringify(res.data?.device?.state));

  const speaker = devices.find((d) => d.kind === 'speaker');
  if (speaker) {
    res = await call(`/api/devices/${speaker.id}/command`, { method: 'POST', body: { command: 'setVolume', args: { value: 40 } } });
    ok('setVolume {value:40}', res.data?.device?.state?.volume === 40, JSON.stringify(res.data?.device?.state));
  }

  const blinds = devices.find((d) => d.kind === 'blinds');
  if (blinds) {
    res = await call(`/api/devices/${blinds.id}/command`, { method: 'POST', body: { command: 'setPosition', args: { value: 50 } } });
    ok('setPosition {value:50}', res.data?.device?.state?.position === 50, JSON.stringify(res.data?.device?.state));
  }

  const lock = devices.find((d) => d.kind === 'lock');
  res = await call(`/api/devices/${lock.id}/command`, { method: 'POST', body: { command: 'unlock' } });
  ok('unlock', res.data?.device?.state?.locked === false);
  res = await call(`/api/devices/${lock.id}/command`, { method: 'POST', body: { command: 'lock' } });
  ok('lock', res.data?.device?.state?.locked === true);

  const bad = await call(`/api/devices/${light.id}/command`, { method: 'POST', body: { command: 'explode' } });
  ok('unknown command rejected or reported', bad.status < 500, `status ${bad.status}`);
}

console.log('\n== scenes ==');
{
  const res = await call(`/api/scenes/${scenes[0].id}/run`, { method: 'POST' });
  ok('scene run returns results', Array.isArray(res.data?.results) && res.data.results.length > 0, JSON.stringify(res.data).slice(0, 200));
}

console.log('\n== automations ==');
let createdId = '';
{
  const light = devices.find((d) => d.kind === 'light');
  const created = await call('/api/automations', {
    method: 'POST',
    body: {
      name: 'Smoke test dusk rule',
      enabled: true,
      trigger: { kind: 'sun_event', op: 'eq', value: 18 },
      conditions: [],
      actions: [{ deviceId: light.id, command: 'turnOn' }],
    },
  });
  createdId = created.data?.automation?.id ?? '';
  ok('create automation', Boolean(createdId), JSON.stringify(created.data).slice(0, 200));

  const toggled = await call(`/api/automations/${createdId}`, { method: 'PATCH', body: { enabled: false } });
  ok('toggle automation off', toggled.data?.automation?.enabled === false);

  const ran = await call(`/api/automations/${createdId}/run`, { method: 'POST' });
  ok('run automation', ran.status === 200, `status ${ran.status}`);

  const wx = await call('/api/automations', {
    method: 'POST',
    body: {
      name: 'Smoke weather rule',
      enabled: true,
      trigger: { kind: 'weather', op: 'lt', metric: 'outdoorTemp', value: 5 },
      actions: [{ deviceKind: 'light', command: 'turnOn' }],
    },
  });
  ok('create weather automation (now supported)', Boolean(wx.data?.automation?.id), JSON.stringify(wx.data).slice(0, 200));
  const wxId = wx.data?.automation?.id;
  if (wxId) await call(`/api/automations/${wxId}`, { method: 'DELETE' });

  const del = await call(`/api/automations/${createdId}`, { method: 'DELETE' });
  ok('delete automation', del.data?.ok === true);
}

console.log('\n== device pairing ==');
let newId = '';
{
  const res = await call('/api/devices', {
    method: 'POST',
    body: { name: 'Smoke Test Lamp', kind: 'light', roomId: homeId ? (await call('/api/home')).data.rooms[0].id : null },
  });
  newId = res.data?.device?.id ?? '';
  ok('create device', Boolean(newId), JSON.stringify(res.data).slice(0, 200));

  const fav = await call(`/api/devices/${newId}`, { method: 'PATCH', body: { favorite: true } });
  ok('toggle favorite', fav.data?.device?.favorite === true);

  const del = await call(`/api/devices/${newId}`, { method: 'DELETE' });
  ok('delete device', del.data?.ok === true);
}

console.log('\n== assistant ==');
{
  const res = await call('/api/ai/chat', { method: 'POST', body: { message: 'turn on the living room lights' } });
  ok('ai/chat returns reply', typeof res.data?.reply === 'string' && res.data.reply.length > 0);
  ok('ai/chat returns intent', typeof res.data?.plan?.intent === 'string', JSON.stringify(res.data?.plan));

  const res2 = await call('/api/ai/chat', { method: 'POST', body: { message: 'what is on right now?' } });
  ok('ai/chat answers status question', typeof res2.data?.reply === 'string' && res2.data.reply.length > 10);
}

console.log('\n== simulation clock ==');
{
  const before = await call('/api/sim');
  await new Promise((r) => setTimeout(r, 2500));
  const after = await call('/api/sim');
  ok('clock advances', after.data.simNow > before.data.simNow, `${before.data.simNow} -> ${after.data.simNow}`);
  const scaled = after.data.simNow - before.data.simNow;
  ok('clock runs faster than real time', scaled > 2500 * 10, `advanced ${scaled}ms in ~2500ms`);

  const set = await call('/api/sim/scale', { method: 'POST', body: { scale: 10 } });
  ok('set scale 10', set.data?.scale === 10);
  await call('/api/sim/scale', { method: 'POST', body: { scale: 60 } });
}

console.log('\n== websocket ==');
{
  const wsUrl = `${BASE.replace('http', 'ws')}/realtime?token=${encodeURIComponent(token)}&homeId=${encodeURIComponent(homeId)}`;
  const received = new Set();
  const done = new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out; got [${[...received].join(', ')}]`));
    }, 12000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', homeId }));
      // Poke a device so a state frame is guaranteed.
      const light = devices.find((d) => d.kind === 'light');
      fetch(`${BASE}/api/devices/${light.id}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: 'toggle' }),
      });
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        received.add(msg.type);
        if (received.has('hello') && received.has('energy') && received.has('subscribed')) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  try {
    await done;
    ok('ws connects and authenticates', received.has('hello'), [...received].join(','));
    ok('ws sends energy frames', received.has('energy'), [...received].join(','));
    ok('ws confirms subscription', received.has('subscribed'), [...received].join(','));
  } catch (err) {
    fail += 1;
    console.log(`  FAIL  websocket: ${err.message}`);
  }
}

console.log('\n== unauthorized access ==');
{
  const saved = token;
  token = 'not-a-real-token';
  const res = await call('/api/home');
  ok('bad token rejected', res.status === 401, `status ${res.status}`);
  token = '';
  const res2 = await call('/api/home');
  ok('missing token rejected', res2.status === 401, `status ${res2.status}`);
  token = saved;
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);