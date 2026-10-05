import * as THREE from 'three';

/** Shared camera-orbit state, smoothed toward a target set by gestures. */
export interface OrbitInput {
  azimuth: number;
  polar: number;
  distance: number;
  targetAzimuth: number;
  targetPolar: number;
  targetDistance: number;
  minDistance: number;
  maxDistance: number;
}

/** Frame-rate independent smoothing plus clamping. */
export function updateOrbit(orbit: OrbitInput, delta: number, damping = 9): void {
  const k = 1 - Math.exp(-damping * delta);
  orbit.azimuth += (orbit.targetAzimuth - orbit.azimuth) * k;
  orbit.polar += (orbit.targetPolar - orbit.polar) * k;
  orbit.distance += (orbit.targetDistance - orbit.distance) * k;
  orbit.polar = Math.max(0.18, Math.min(1.42, orbit.polar));
  orbit.distance = Math.max(orbit.minDistance, Math.min(orbit.maxDistance, orbit.distance));
}

/** Places the camera on an orbit around a target point. */
export function applyOrbit(camera: THREE.PerspectiveCamera, orbit: OrbitInput, target: THREE.Vector3): void {
  const sinPolar = Math.sin(orbit.polar);
  camera.position.set(
    target.x + orbit.distance * sinPolar * Math.sin(orbit.azimuth),
    target.y + orbit.distance * Math.cos(orbit.polar),
    target.z + orbit.distance * sinPolar * Math.cos(orbit.azimuth),
  );
  camera.lookAt(target);
}