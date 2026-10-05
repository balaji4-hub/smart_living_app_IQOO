import * as THREE from 'three';
import type { Device, Room, Sun } from '../api/types';
import { applyOrbit, updateOrbit, type OrbitInput } from './orbit';
import type { SceneBuilder, SceneContext } from './ThreeCanvas';
import { buildFurniture, createMaterials, deviceColor, makeCore } from './sceneParts';

export interface HomeSceneRefs {
  devicesRef: React.RefObject<Record<string, Device>>;
  sunRef: React.RefObject<Sun | null>;
  selectedRef: React.RefObject<string | null>;
  focusedRoomRef: React.RefObject<string | null>;
  orbit: React.RefObject<OrbitInput>;
  kindColors: Record<string, THREE.Color>;
  onHover?: (id: string | null) => void;
}

const WALL_H = 0.95;
const UP = new THREE.Vector3(0, 1, 0);

interface Marker {
  id: string;
  group: THREE.Group;
  core: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  haloMaterial: THREE.MeshBasicMaterial;
  light?: THREE.PointLight;
  color: THREE.Color;
  kind: Device['kind'];
  phase: number;
  baseY: number;
  targetY: number;
  /** Latest known state, read from the store on every frame. */
  on: boolean;
  level: number;
}

export const buildHomeScene = (rooms: Room[], refs: HomeSceneRefs): SceneBuilder =>
  ({ scene, camera, width, height }: SceneContext) => {
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(obj: T): T => {
      disposables.push(obj);
      return obj;
    };

    const materials = createMaterials();
    Object.values(materials).forEach(track);

    // ---- Environment -----------------------------------------------------
    const hemi = new THREE.HemisphereLight(0x6f8dd6, 0x0a0f1c, 0.55);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d6, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0012;
    scene.add(sun);
    scene.add(sun.target);

    const fill = new THREE.PointLight(0x5b8def, 0.5, 40, 2);
    fill.position.set(0, 9, 0);
    scene.add(fill);

    // ---- Floor plan ------------------------------------------------------
    const group = new THREE.Group();
    scene.add(group);

    const pickables: THREE.Mesh[] = [];
    const markers: Marker[] = [];
    const roomGroups = new Map<string, THREE.Group>();
    const accentMeshes = new Map<string, THREE.Mesh>();

    const extent = rooms.reduce(
      (acc, r) => ({
        maxX: Math.max(acc.maxX, r.x + r.w),
        maxZ: Math.max(acc.maxZ, r.z + r.d),
      }),
      { maxX: 0, maxZ: 0 },
    );
    const centerX = extent.maxX / 2;
    const centerZ = extent.maxZ / 2;
    const target = new THREE.Vector3(centerX, 0, centerZ);

    // Ground slab under the whole plan so the house does not float in space.
    const groundGeo = track(new THREE.PlaneGeometry(extent.maxX + 6, extent.maxZ + 6));
    const groundMat = track(
      new THREE.MeshStandardMaterial({ color: 0x090d18, roughness: 0.95, metalness: 0.05 }),
    );
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.02, centerZ);
    ground.receiveShadow = true;
    group.add(ground);

    // Faint grid to give the void some scale.
    const grid = new THREE.GridHelper(Math.max(extent.maxX, extent.maxZ) + 8, 40, 0x1b2540, 0x121a2c);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.set(centerX, 0.005, centerZ);
    group.add(grid);

    for (const room of rooms) {
      const roomGroup = new THREE.Group();
      roomGroup.userData.roomId = room.id;
      group.add(roomGroup);
      roomGroups.set(room.id, roomGroup);

      const cx = room.x + room.w / 2;
      const cz = room.z + room.d / 2;

      // Floor plate, tinted by the room accent.
      const accent = new THREE.Color(room.accent);
      const floorGeo = track(new THREE.BoxGeometry(room.w, 0.08, room.d));
      const floorMat = track(
        new THREE.MeshStandardMaterial({
          color: accent.clone().multiplyScalar(0.16),
          emissive: accent.clone().multiplyScalar(0.1),
          roughness: 0.85,
          metalness: 0.1,
        }),
      );
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.position.set(cx, 0.04, cz);
      floor.receiveShadow = true;
      floor.userData.roomId = room.id;
      roomGroup.add(floor);
      accentMeshes.set(room.id, floor);

      // Outline so rooms read clearly from any angle.
      const edges = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(floorGeo)),
        track(
          new THREE.LineBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      );
      edges.position.copy(floor.position);
      edges.position.y += 0.045;
      roomGroup.add(edges);

      // Low walls on every edge, with a doorway gap implied by height.
      const wallMat = materials.wall;
      const wallGeoH = track(new THREE.BoxGeometry(room.w, WALL_H, 0.07));
      const wallGeoW = track(new THREE.BoxGeometry(0.07, WALL_H, room.d));
      const north = new THREE.Mesh(wallGeoH, wallMat);
      north.position.set(cx, WALL_H / 2, room.z);
      north.castShadow = true;
      north.receiveShadow = true;
      north.userData.roomId = room.id;
      roomGroup.add(north);

      const south = new THREE.Mesh(wallGeoH, wallMat);
      south.position.set(cx, WALL_H / 2, room.z + room.d);
      south.castShadow = true;
      south.receiveShadow = true;
      roomGroup.add(south);

      const west = new THREE.Mesh(wallGeoW, wallMat);
      west.position.set(room.x, WALL_H / 2, cz);
      west.castShadow = true;
      west.receiveShadow = true;
      west.userData.roomId = room.id;
      roomGroup.add(west);

      const east = new THREE.Mesh(wallGeoW, wallMat);
      east.position.set(room.x + room.w, WALL_H / 2, cz);
      east.castShadow = true;
      east.receiveShadow = true;
      roomGroup.add(east);

      roomGroup.add(buildFurniture(room, materials));
    }

    // ---- Device markers --------------------------------------------------
    const haloGeo = track(new THREE.RingGeometry(0.22, 0.34, 32));
    const pickGeo = track(new THREE.SphereGeometry(0.42, 10, 8));
    const pickMaterial = track(new THREE.MeshBasicMaterial({ visible: false }));
    const markerRoot = new THREE.Group();
    group.add(markerRoot);

    const buildMarkers = (list: Device[]) => {
      for (const device of list) {
        if (!device.roomId) continue;
        const color = deviceColor(device.kind, refs.kindColors);
        const core = makeCore(device.kind, color);
        const baseY = 0.5;

        const markerGroup = new THREE.Group();
        markerGroup.position.set(device.placement.x, baseY, device.placement.z);
        if (device.placement.rotY) markerGroup.rotation.y = device.placement.rotY;

        const haloMaterial = track(
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
        );
        const halo = new THREE.Mesh(haloGeo, haloMaterial);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = -baseY + 0.14;
        markerGroup.add(halo);

        const stemMaterial = track(
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 }),
        );
        const stem = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, baseY, 6)), stemMaterial);
        stem.position.y = -baseY / 2 + 0.14;
        markerGroup.add(stem);

        core.position.y = 0.14;
        core.userData.deviceId = device.id;
        core.userData.roomId = device.roomId;
        markerGroup.add(core);

        // Markers are only a few pixels wide on a phone, so raycast against an
        // invisible proxy sphere instead. Without this, tapping is a lottery.
        const proxy = new THREE.Mesh(pickGeo, pickMaterial);
        proxy.position.y = 0.14;
        proxy.visible = false;
        proxy.userData.deviceId = device.id;
        proxy.userData.roomId = device.roomId;
        markerGroup.add(proxy);

        markerRoot.add(markerGroup);
        pickables.push(proxy, core);

        let light: THREE.PointLight | undefined;
        if (device.kind === 'light' || device.kind === 'fan' || device.kind === 'tv') {
          light = new THREE.PointLight(color, 0, 4.2, 2);
          light.position.y = 0.2;
          markerGroup.add(light);
        }

        const state = device.state ?? {};
        markers.push({
          id: device.id,
          group: markerGroup,
          core,
          material: core.material as THREE.MeshStandardMaterial,
          halo,
          haloMaterial,
          light,
          color,
          kind: device.kind,
          phase: markers.length * 0.7,
          baseY,
          targetY: 0,
          on: state.power === 'on',
          level: state.brightness ?? state.level ?? 100,
        });
      }
    };

    buildMarkers(Object.values(refs.devicesRef.current ?? {}));
    const markerCount = markers.length;

    // ---- Picking ---------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const hitTest = (px: number, py: number): string | null => {
      // The render loop normally refreshes these, but picking must not depend
      // on a render having happened first.
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();

      ndc.x = (px / width) * 2 - 1;
      ndc.y = -((py / height) * 2 - 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      for (const hit of hits) {
        const id = hit.object.userData.deviceId as string | undefined;
        if (id) return id;
      }
      return null;
    };

    const selectionRing = new THREE.Mesh(
      track(new THREE.RingGeometry(0.3, 0.42, 40)),
      track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;
    group.add(selectionRing);

    // ---- Frame update ----------------------------------------------------
    let lastDeviceCount = markerCount;

    const syncMarkers = () => {
      const devices = Object.values(refs.devicesRef.current ?? {});
      if (devices.length !== lastDeviceCount) {
        markerRoot.clear();
        markers.length = 0;
        pickables.length = 0;
        buildMarkers(devices);
        lastDeviceCount = markers.length;
      }
    };

    return {
      update(delta, elapsed) {
        syncMarkers();

        const orbit = refs.orbit.current;
        if (orbit) {
          updateOrbit(orbit, delta);
          applyOrbit(camera, orbit, target);
        }

        // Daylight follows the simulated sun position.
        const sunInfo = refs.sunRef.current;
        if (sunInfo) {
          const alt = sunInfo.altitude;
          const daylight = THREE.MathUtils.clamp(alt / 55, 0, 1);
          const angle = ((sunInfo.azimuth - 180) * Math.PI) / 180;
          sun.position.set(
            centerX + Math.cos(angle) * 14 * Math.max(0.25, daylight),
            Math.max(1.5, Math.sin((alt * Math.PI) / 180) * 20),
            centerZ + Math.sin(angle) * 14 * Math.max(0.25, daylight),
          );
          sun.intensity = 0.25 + daylight * 1.9;
          sun.color.setHSL(0.09 - daylight * 0.03, 0.75 - daylight * 0.35, 0.62);
          hemi.intensity = 0.28 + daylight * 0.42;
          hemi.color.setHSL(0.62 - daylight * 0.08, 0.45, 0.32 + daylight * 0.18);
          fill.intensity = 0.25 + (1 - daylight) * 0.75;
        }

        const devices = refs.devicesRef.current ?? {};
        const selected = refs.selectedRef.current;
        const focusedRoom = refs.focusedRoomRef.current;

        // Focus dimming: the selected room stays bright, others recede.
        for (const [roomId, accentMesh] of accentMeshes) {
          const dim = focusedRoom && focusedRoom !== roomId;
          const mat = accentMesh.material as THREE.MeshStandardMaterial;
          const base = new THREE.Color(
            rooms.find((r) => r.id === roomId)?.accent ?? '#5B8DEF',
          );
          const target_ = base.clone().multiplyScalar(dim ? 0.07 : 0.16);
          mat.color.lerp(target_, 0.08);
          const emissiveTarget = base.clone().multiplyScalar(dim ? 0.02 : 0.1);
          mat.emissive.lerp(emissiveTarget, 0.08);
        }

        let selectedMarker: Marker | undefined;

        for (const marker of markers) {
          const device = devices[marker.id];
          if (!device) {
            marker.group.visible = false;
            continue;
          }
          marker.group.visible = true;

          const state = device.state ?? {};
          const powered = Boolean(
            state.power === 'on' ||
              (marker.kind === 'lock' && state.locked) ||
              (marker.kind === 'sensor_motion' && state.motion) ||
              (marker.kind === 'sensor_leak' && state.leak) ||
              (marker.kind === 'sensor_contact' && state.open) ||
              (marker.kind === 'camera' && state.recording),
          );

          marker.on = powered;
          marker.level = state.brightness ?? state.level ?? 100;

          const attention =
            marker.kind === 'lock' && state.locked
              ? 0
              : marker.kind === 'sensor_leak' && state.leak
                ? 1
                : marker.kind === 'sensor_motion' && state.motion
                  ? 2
                  : 0;

          const pulse = powered ? 0.72 + Math.sin(elapsed * 2.2 + marker.phase) * 0.14 : 0.22;
          marker.material.emissiveIntensity = powered ? pulse * 1.6 : 0.18;
          marker.material.color.copy(marker.color).multiplyScalar(powered ? 1 : 0.42);
          marker.material.emissive.copy(marker.color).multiplyScalar(powered ? 0.85 : 0.12);

          // Active devices breathe and float slightly.
          marker.targetY = powered ? Math.sin(elapsed * 1.5 + marker.phase) * 0.05 : 0;
          marker.group.position.y = marker.baseY + marker.targetY;

          // Hot devices spin; blinds slide; everything else is static.
          if (marker.kind === 'fan' && state.power === 'on') marker.core.rotation.y += delta * 9;
          if (marker.kind === 'vacuum' && state.power === 'on') marker.group.rotation.y += delta * 1.4;
          if (marker.kind === 'blinds') {
            const pos = (state.position ?? 0) / 100;
            marker.core.scale.y = 0.35 + pos * 0.9;
            marker.core.rotation.x = -pos * 1.2;
          }
          if (marker.kind === 'camera' || marker.kind === 'doorbell') {
            marker.core.rotation.y = state.recording
              ? Math.sin(elapsed * 2.4 + marker.phase) * 0.7
              : 0;
          }

          const alertBoost = attention === 1 ? 1 + Math.sin(elapsed * 7) * 0.5 : 1;
          marker.haloMaterial.opacity = (powered ? 0.3 : 0.12) * alertBoost;
          const haloScale = powered ? 1 + Math.sin(elapsed * 2 + marker.phase) * 0.12 : 0.85;
          marker.halo.scale.setScalar(haloScale);

          if (marker.light) {
            const watts = state.powerWatts ?? 0;
            const brightness = (state.brightness ?? 100) / 100;
            marker.light.intensity = powered ? Math.min(2.4, 0.35 + watts / 14 + brightness * 0.6) : 0;
            marker.light.distance = 3 + brightness * 2.5;
          }

          if (marker.id === selected) selectedMarker = marker;
        }

        if (selectedMarker) {
          selectionRing.visible = true;
          selectionRing.position.set(selectedMarker.group.position.x, 0.14, selectedMarker.group.position.z);
          const s = 1 + Math.sin(elapsed * 4) * 0.12;
          selectionRing.scale.setScalar(s);
          (selectionRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(elapsed * 4) * 0.25;
        } else {
          selectionRing.visible = false;
        }
      },

      pick: (x, y) => {
        const id = hitTest(x, y);
        return id ? { id } : null;
      },

      dispose() {
        if (scene.fog) scene.fog = null;
        disposables.forEach((d) => d.dispose());
        disposables.length = 0;
        scene.clear();
        void UP;
      },
    };
  };