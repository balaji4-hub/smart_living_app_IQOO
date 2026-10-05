import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import type { OrbitInput } from './orbit';

export type { OrbitInput } from './orbit';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}

export type SceneBuilder = (ctx: SceneContext) => {
  /** Called once per frame with elapsed seconds since the previous frame. */
  update: (delta: number, elapsed: number) => void;
  /** Maps a normalised screen point to a payload, or null when nothing is hit. */
  pick?: (x: number, y: number) => { id: string } | null;
  dispose?: () => void;
};

export interface ThreeCanvasHandle {
  /** Runs a callback on the GL thread outside the React render cycle. */
  run: (fn: (ctx: SceneContext) => void) => void;
  pick: (x: number, y: number) => { id: string } | null;
}

interface Props {
  build: SceneBuilder;
  input: React.RefObject<OrbitInput>;
  onPick?: (id: string | null) => void;
  style?: StyleProp<ViewStyle>;
  onContextLost?: () => void;
}

/**
 * Hosts a real WebGL renderer through expo-gl and drives it with a
 * requestAnimationFrame loop, the same way three.js runs on the web.
 */
export function ThreeCanvas({ build, input, onPick, style, onContextLost }: Props) {
  const holder = useRef<{
    ctx: SceneContext | null;
    controller: ReturnType<SceneBuilder> | null;
    raf: number | null;
    last: number;
    start: number;
    ready: boolean;
  }>({ ctx: null, controller: null, raf: null, last: 0, start: 0, ready: false });

  const buildRef = useRef(build);
  buildRef.current = build;
  const inputRef = useRef(input);
  inputRef.current = input;

  const handleContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      const state = holder.current;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;

      // three.js expects a DOM-ish canvas; expo-gl hands us an ES context.
      const canvasShim = {
        width,
        height,
        style: {},
        clientWidth: width,
        clientHeight: height,
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => gl,
        setAttribute: () => {},
      } as unknown as HTMLCanvasElement;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: canvasShim,
          context: gl as unknown as WebGLRenderingContext,
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        });
      } catch {
        onContextLost?.();
        return;
      }

      renderer.setPixelRatio(Math.min(gl.drawingBufferWidth / Math.max(1, width), 2));
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, width / Math.max(1, height), 0.1, 200);

      state.ctx = { scene, camera, width, height };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (renderer as any).__slScene = scene;

      state.controller = buildRef.current(state.ctx);
      state.ready = true;
      state.start = Date.now();
      state.last = Date.now();

      const loop = () => {
        const now = Date.now();
        const delta = Math.min(0.05, (now - state.last) / 1000);
        state.last = now;
        const elapsed = (now - state.start) / 1000;

        try {
          state.controller?.update(delta, elapsed);
          renderer.render(scene, camera);
          gl.endFrameEXP();
        } catch (error) {
          console.warn('[three] frame error', error);
        }

        state.raf = requestAnimationFrame(loop);
      };

      state.raf = requestAnimationFrame(loop);
    },
    [onContextLost],
  );

  useEffect(
    () => () => {
      const state = holder.current;
      if (state.raf !== null) cancelAnimationFrame(state.raf);
      state.raf = null;
      state.controller?.dispose?.();
      state.controller = null;
      state.ctx = null;
      state.ready = false;
    },
    [],
  );

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="box-none">
      <GLView
        style={StyleSheet.absoluteFill}
        onContextCreate={handleContextCreate}
        enableExperimentalWorkletSupport={false}
      />
    </View>
  );
}
