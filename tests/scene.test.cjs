/**
 * Runs the real 3D scene builder headlessly against three.js so the floor plan,
 * furniture, markers, lighting and picking logic are exercised without a device.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = process.env.SL_SCENE_BUILD || path.join(ROOT, 'tests', '.build');
const THREE = require(path.join(ROOT, 'mobile', 'node_modules', 'three'));

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

const { buildHomeScene } = require(path.join(BUILD, 'three', 'homeScene.js'));

const rooms = [
  { id: 'room_living', home_id: 'h1', name: 'Living Room', kind: 'living', position: 1, accent: '#5B8DEF', x: 0, z: 0, w: 6, d: 5, deviceCount: 8 },
  { id: 'room_kitchen', home_id: 'h1', name: 'Kitchen', kind: 'kitchen', position: 2, accent: '#F2A03D', x: 6, z: 0, w: 6, d: 5, deviceCount: 5 },
  { id: 'room_bed', home_id: 'h1', name: 'Bedroom', kind: 'bedroom', position: 3, accent: '#7C5CFF', x: 0, z: 5, w: 3.2, d: 3, deviceCount: 3 },
  { id: 'room_bath', home_id: 'h1', name: 'Bathroom', kind: 'bathroom', position: 4, accent: '#48C2E0', x: 3.2, z: 5, w: 2.8, d: 3, deviceCount: 2 },
  { id: 'room_hall', home_id: 'h1', name: 'Hallway', kind: 'hallway', position: 5, accent: '#A9B4CE', x: 6, z: 5, w: 3, d: 3, deviceCount: 2 },
  { id: 'room_office', home_id: 'h1', name: 'Office', kind: 'office', position: 6, accent: '#3DDC97', x: 9, z: 5, w: 3, d: 3, deviceCount: 2 },
  { id: 'room_garage', home_id: 'h1', name: 'Garage', kind: 'garage', position: 7, accent: '#FF8A5B', x: 1, z: 9.4, w: 5, d: 3.4, deviceCount: 1 },
];

const kinds = ['light', 'thermostat', 'lock', 'camera', 'sensor_motion', 'sensor_leak', 'plug', 'speaker', 'tv', 'blinds', 'fan', 'air_quality', 'vacuum', 'garage', 'doorbell'];

function makeDevices() {
  const out = {};
  let n = 0;
  for (const room of rooms) {
    for (let i = 0; i < 3; i += 1) {
      const kind = kinds[n % kinds.length];
      const id = `dev_${room.id}_${i}`;
      const x = room.x + 0.8 + (i * 1.6) % Math.max(0.6, room.w - 1.2);
      const z = room.z + 0.8 + ((i * 2.1) % Math.max(0.6, room.d - 1.2));
      const base = {
        id,
        name: `${room.name} ${kind} ${i}`,
        kind,
        roomId: room.id,
        roomName: room.name,
        manufacturer: 'Test',
        model: 'X',
        favorite: i === 0,
        category: 'Test',
        placement: { x, y: 1, z },
        updatedAt: Date.now(),
      };
      const state = { power: 'off', powerWatts: 0 };
      if (kind === 'light') Object.assign(state, { power: 'on', brightness: 70, powerWatts: 12 });
      if (kind === 'thermostat') Object.assign(state, { power: 'on', temperature: 20.4, targetTemperature: 21.5, mode: 'heat', powerWatts: 900 });
      if (kind === 'lock') Object.assign(state, { locked: true, battery: 82 });
      if (kind === 'sensor_motion') Object.assign(state, { motion: n % 2 === 0, battery: 55 });
      if (kind === 'sensor_leak') Object.assign(state, { leak: n % 3 === 0, battery: 91, humidity: 55 });
      if (kind === 'sensor_contact') Object.assign(state, { open: n % 4 === 0, battery: 77 });
      if (kind === 'speaker') Object.assign(state, { power: 'on', volume: 35, playing: 'Jazz', powerWatts: 8 });
      if (kind === 'tv') Object.assign(state, { power: 'on', brightnessBacklight: 60, powerWatts: 110 });
      if (kind === 'blinds') Object.assign(state, { position: 60, level: 60, powerWatts: 2 });
      if (kind === 'fan') Object.assign(state, { power: 'on', level: 2, powerWatts: 25 });
      if (kind === 'air_quality') Object.assign(state, { co2: 780, voc: 140, pm25: 9, humidity: 48, temperature: 21 });
      if (kind === 'camera') Object.assign(state, { recording: n % 2 === 1, power: 'on', powerWatts: 6 });
      if (kind === 'vacuum') Object.assign(state, { power: n % 2 === 0 ? 'on' : 'off', battery: 44, powerWatts: 30 });
      if (kind === 'garage') Object.assign(state, { open: n % 2 === 0, powerWatts: 0 });
      if (kind === 'doorbell') Object.assign(state, { motionDetected: n % 2 === 0, lastMotionAt: Date.now() - 60000, battery: 80 });
      if (kind === 'plug') Object.assign(state, { power: 'on', powerWatts: 145 });
      out[id] = { ...base, state };
      n += 1;
    }
  }
  return out;
}

const devices = makeDevices();
const devicesRef = { current: devices };
const sunRef = { current: { altitude: 32, azimuth: 150, sunriseMin: 368, sunsetMin: 1049 } };
const selectedRef = { current: 'dev_room_living_0' };
const focusedRoomRef = { current: null };
const orbit = {
  current: {
    azimuth: 0.72, polar: 0.92, distance: 17,
    targetAzimuth: 0.72, targetPolar: 0.92, targetDistance: 17,
    minDistance: 7, maxDistance: 30,
  },
};

const kindColors = {};
for (const kind of kinds) kindColors[kind] = new THREE.Color('#5B8DEF');

console.log('\n== scene construction ==');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 390 / 844, 0.1, 200);

let controller;
let buildError = null;
try {
  const builder = buildHomeScene(rooms, { devicesRef, sunRef, selectedRef, focusedRoomRef, orbit, kindColors });
  controller = builder({ scene, camera, width: 390, height: 844 });
  ok('builder returns a controller', Boolean(controller));
  ok('controller exposes update', typeof controller.update === 'function');
  ok('controller exposes pick', typeof controller.pick === 'function');
} catch (err) {
  buildError = err;
  ok('builder runs without throwing', false, err.stack);
}

if (controller) {
  console.log('\n== scene graph ==');
  let meshes = 0;
  let lights = 0;
  scene.traverse((obj) => {
    if (obj.isMesh) meshes += 1;
    if (obj.isLight) lights += 1;
  });
  ok('built furniture/room meshes', meshes > 40, `meshes=${meshes}`);
  ok('added lights', lights >= 2, `lights=${lights}`);

  const pickIds = new Set();
  scene.traverse((obj) => {
    if (obj.userData && obj.userData.deviceId) pickIds.add(obj.userData.deviceId);
  });
  ok('every device is tagged for picking', pickIds.size === Object.keys(devices).length, `tagged=${pickIds.size} devices=${Object.keys(devices).length}`);

  let floors = 0;
  scene.traverse((obj) => {
    if (obj.userData && obj.userData.roomId && obj.geometry?.type === 'BoxGeometry') floors += 1;
  });
  ok('rooms have pickable floors', floors >= rooms.length, `floors=${floors}`);

  console.log('\n== frame loop ==');
  let loopError = null;
  try {
    for (let frame = 0; frame < 400; frame += 1) {
      // Animate the things gestures would change.
      if (frame === 50) orbit.current.targetAzimuth += 1.4;
      if (frame === 100) orbit.current.targetDistance = 8;
      if (frame === 150) orbit.current.targetPolar = 0.3;
      if (frame === 200) focusedRoomRef.current = 'room_kitchen';
      if (frame === 250) {
        const d = devicesRef.current['dev_room_living_1_thermostat'];
        if (d) d.state.temperature = 21.6;
      }
      if (frame === 300) selectedRef.current = null;
      if (frame === 320) {
        // Add a device mid-flight: markers must resync without throwing.
        devicesRef.current.dev_new = {
          ...devicesRef.current['dev_room_living_0'],
          id: 'dev_new',
          name: 'Late arrival',
          roomId: 'room_office',
          roomName: 'Office',
          placement: { x: 10, y: 1, z: 6 },
        };
      }
      controller.update(1 / 60, frame / 60);
    }
  } catch (err) {
    loopError = err;
  }
  ok('400 frames run without throwing', !loopError, loopError ? loopError.stack : '');

  console.log('\n== camera behaviour ==');
  ok('camera moved off its origin', camera.position.length() > 1, `len=${camera.position.length().toFixed(2)}`);
  ok('camera respects maxDistance', camera.position.length() <= 31, `len=${camera.position.length().toFixed(2)}`);

  console.log('\n== picking ==');
  // Sweep a grid of screen points; at least one should hit a device.
  let hits = 0;
  try {
    for (let x = 2; x < 390; x += 4) {
      for (let y = 2; y < 844; y += 6) {
        const hit = controller.pick(x, y);
        if (hit && typeof hit.id === 'string') hits += 1;
      }
    }
  } catch (err) {
    ok('pick does not throw', false, err.stack);
  }
  ok('pick sweep finds devices', hits > 0, `hits=${hits}`);
  const liveIds = new Set(Object.keys(devicesRef.current));
  const sweepIds = new Set();
  for (let x = 2; x < 390; x += 17) {
    for (let y = 2; y < 844; y += 23) {
      const hit = controller.pick(x, y);
      if (hit) sweepIds.add(hit.id);
    }
  }
  const unknown = [...sweepIds].filter((id) => !liveIds.has(id));
  ok('every picked id is a live device', unknown.length === 0, `unknown=[${unknown.join(',')}]`);
  ok('picking reaches multiple devices', sweepIds.size >= 3, `distinct=${sweepIds.size}`);

  console.log('\n== night + extreme states ==');
  let nightError = null;
  try {
    sunRef.current = { altitude: -14, azimuth: 300, sunriseMin: 368, sunsetMin: 1049 };
    for (const device of Object.values(devicesRef.current)) {
      device.state.leak = true;
      device.state.motion = true;
      device.state.brightness = 0;
      device.state.position = 0;
    }
    for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 60, frame / 60);
  } catch (err) {
    nightError = err;
  }
  ok('night + all-alert states render', !nightError, nightError ? nightError.stack : '');

  console.log('\n== empty house ==');
  let emptyError = null;
  try {
    devicesRef.current = {};
    selectedRef.current = null;
    for (let frame = 0; frame < 60; frame += 1) controller.update(1 / 60, frame / 60);
    controller.pick(100, 100);
  } catch (err) {
    emptyError = err;
  }
  ok('empty device list renders', !emptyError, emptyError ? emptyError.stack : '');

  console.log('\n== dispose ==');
  let disposeError = null;
  try {
    controller.dispose?.();
  } catch (err) {
    disposeError = err;
  }
  ok('dispose runs cleanly', !disposeError, disposeError ? disposeError.stack : '');
  ok('dispose clears the scene', scene.children.length === 0, `children=${scene.children.length}`);
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);