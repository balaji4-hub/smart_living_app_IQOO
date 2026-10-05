import * as THREE from 'three';
import type { Device, Room } from '../api/types';

function material(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.06, ...opts });
}

export function deviceColor(kind: Device['kind'], kindColors: Record<string, THREE.Color>): THREE.Color {
  return kindColors[kind] ?? new THREE.Color('#7C5CFF');
}

/** Maps a device kind to a small piece of geometry that reads at a glance. */
export function makeCore(kind: Device['kind'], color: THREE.Color): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  let emissiveIntensity = 1.4;

  switch (kind) {
    case 'light':
      geometry = new THREE.SphereGeometry(0.15, 20, 14);
      break;
    case 'fan':
      geometry = new THREE.CylinderGeometry(0.16, 0.16, 0.07, 20);
      emissiveIntensity = 0.9;
      break;
    case 'vacuum':
      geometry = new THREE.CylinderGeometry(0.17, 0.17, 0.07, 22);
      emissiveIntensity = 0.9;
      break;
    case 'blinds':
      geometry = new THREE.BoxGeometry(0.55, 0.2, 0.06);
      emissiveIntensity = 0.7;
      break;
    case 'tv':
    case 'speaker':
    case 'plug':
    case 'lock':
    case 'garage':
    case 'thermostat_valve':
      geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      break;
    case 'camera':
    case 'doorbell':
      geometry = new THREE.ConeGeometry(0.14, 0.22, 18);
      emissiveIntensity = 1.1;
      break;
    case 'thermostat':
      geometry = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 22);
      emissiveIntensity = 0.9;
      break;
    default:
      geometry = new THREE.SphereGeometry(0.11, 14, 10);
      emissiveIntensity = 1.0;
  }

  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    roughness: 0.32,
    metalness: 0.25,
  });

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = false;
  return mesh;
}

/** Low-poly furniture so each room reads as a real space rather than a box. */
export function buildFurniture(room: Room, materials: Record<string, THREE.Material>): THREE.Group {
  const group = new THREE.Group();
  const cx = room.x + room.w / 2;
  const cz = room.z + room.d / 2;

  const add = (w: number, h: number, d: number, x: number, z: number, mat: THREE.Material, y = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2 + y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  switch (room.kind) {
    case 'living': {
      // Sofa (base + back + arms) facing a TV wall.
      const sx = room.x + 1.3;
      const sz = cz;
      add(0.95, 0.42, 2.2, sx, sz, materials.sofa);
      add(0.22, 0.62, 2.2, sx - 0.48, sz, materials.sofaDark, 0.42);
      add(0.95, 0.28, 0.22, sx, sz - 1.1, materials.sofaDark, 0.42);
      add(0.95, 0.28, 0.22, sx, sz + 1.1, materials.sofaDark, 0.42);
      // Coffee table
      add(0.6, 0.12, 1.1, sx + 1.35, sz, materials.wood, 0.32);
      // TV console against the far wall
      add(1.6, 0.4, 0.4, cx + 1.4, room.z + 0.35, materials.woodDark);
      // Rug
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.2), materials.rug);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(sx + 0.9, 0.012, sz);
      group.add(rug);
      break;
    }
    case 'kitchen': {
      // Counter run along the right wall
      add(0.65, 0.9, room.d - 0.5, room.x + room.w - 0.42, cz, materials.counter);
      add(0.72, 0.06, room.d - 0.5, room.x + room.w - 0.42, cz, materials.counterTop, 0.9);
      // Island
      add(1.5, 0.88, 0.8, cx - 0.4, cz + 0.5, materials.counter);
      add(1.6, 0.06, 0.9, cx - 0.4, cz + 0.5, materials.counterTop, 0.88);
      // Fridge volume
      add(0.75, 1.85, 0.75, room.x + room.w - 0.5, room.z + 0.55, materials.appliance);
      // Dining table
      add(1.15, 0.08, 1.0, cx - 1.4, room.z + 0.9, materials.wood, 0.72);
      add(0.12, 0.72, 0.12, cx - 1.8, room.z + 0.9, materials.woodDark);
      add(0.12, 0.72, 0.12, cx - 1.0, room.z + 0.9, materials.woodDark);
      break;
    }
    case 'bedroom': {
      add(1.5, 0.42, 2.0, cx, cz, materials.bed);
      add(1.56, 0.16, 0.9, cx, cz - 0.55, materials.bedding, 0.42);
      add(1.62, 0.85, 0.14, cx, cz - 1.05, materials.woodDark);
      // Nightstands
      add(0.45, 0.42, 0.42, room.x + 0.35, cz - 0.8, materials.wood);
      add(0.45, 0.42, 0.42, cx + 0.95, cz - 0.8, materials.wood);
      break;
    }
    case 'bathroom': {
      add(0.85, 0.5, 1.7, room.x + 0.65, cz, materials.fixture);
      add(0.9, 0.12, 1.75, room.x + 0.65, cz, materials.fixtureTop, 0.5);
      add(0.5, 0.78, 0.22, room.x + room.w - 0.35, room.z + 0.4, materials.fixture);
      break;
    }
    case 'office': {
      add(1.5, 0.08, 0.75, cx, cz, materials.wood, 0.72);
      add(0.14, 0.72, 0.7, cx - 0.6, cz, materials.woodDark);
      add(0.14, 0.72, 0.7, cx + 0.6, cz, materials.woodDark);
      // Monitor
      add(0.62, 0.36, 0.04, cx, room.z + 0.2, materials.screen, 0.8);
      add(0.1, 0.2, 0.1, cx, room.z + 0.2, materials.metal, 0.8);
      add(0.5, 0.85, 0.5, room.x + 0.5, room.z + room.d - 0.6, materials.woodDark);
      break;
    }
    case 'hallway': {
      add(0.3, 1.6, 0.9, room.x + 0.2, cz, materials.woodDark);
      break;
    }
    case 'garage': {
      add(1.8, 0.75, 4.0, cx, cz, materials.car, 0.0);
      add(1.6, 0.55, 2.0, cx, cz - 0.2, materials.carGlass, 0.75);
      add(0.4, 0.9, 0.4, room.x + 0.45, room.z + 0.5, materials.woodDark);
      break;
    }
    default:
      break;
  }

  return group;
}

export function createMaterials(): Record<string, THREE.Material> {
  return {
    wall: material(0x243050, { roughness: 0.85 }),
    wallCap: material(0x35456e, { roughness: 0.6, metalness: 0.2 }),
    sofa: material(0x2f3d63),
    sofaDark: material(0x222c4a),
    wood: material(0x6b4a34),
    woodDark: material(0x4a3324),
    counter: material(0x1d2740),
    counterTop: material(0x8d9bb5, { roughness: 0.42, metalness: 0.18 }),
    appliance: material(0x9aa6bd, { roughness: 0.35, metalness: 0.4 }),
    bedding: material(0xcdd8f0, { roughness: 0.95 }),
    bed: material(0x33406a),
    fixture: material(0xd7e0f2, { roughness: 0.3 }),
    fixtureTop: material(0xa8b6cf, { roughness: 0.28 }),
    screen: material(0x0d1424, { roughness: 0.15, emissive: 0x1d4f8f, emissiveIntensity: 0.7 }),
    metal: material(0x59657d, { metalness: 0.6, roughness: 0.4 }),
    rug: material(0x1a2340, { roughness: 1 }),
    car: material(0x2a3550, { metalness: 0.45, roughness: 0.35 }),
    carGlass: material(0x0f1728, { roughness: 0.12, metalness: 0.5 }),
  };
}