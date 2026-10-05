import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as THREE from 'three';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatMinutes, useApp } from '../api/store';
import type { Device } from '../api/types';
import { colors, kindColor, radius, space, type } from '../theme';
import { Bar, GlassCard, Metric, Pill, Row, tap } from '../components/ui';
import { glyphForScene } from '../icons';
import { ThreeCanvas, type OrbitInput } from '../three/ThreeCanvas';
import { buildHomeScene } from '../three/homeScene';

const KIND_COLORS: Record<string, THREE.Color> = Object.fromEntries(
  Object.entries(kindColor).map(([kind, hex]) => [kind, new THREE.Color(hex)]),
);

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const snapshot = useApp((s) => s.snapshot);
  const devices = useApp((s) => s.devices);
  const scenes = useApp((s) => s.scenes);
  const selectedId = useApp((s) => s.selectedDeviceId);
  const selectDevice = useApp((s) => s.selectDevice);
  const focusRoom = useApp((s) => s.focusRoom);
  const focusedRoomId = useApp((s) => s.focusedRoomId);
  const runScene = useApp((s) => s.runScene);
  const command = useApp((s) => s.command);
  const liveWatts = useApp((s) => s.liveWatts);

  const pickRef = useRef<((x: number, y: number) => { id: string } | null) | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const sunRef = useRef(snapshot?.sun ?? null);
  sunRef.current = snapshot?.sun ?? null;
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;
  const focusedRoomRef = useRef<string | null>(focusedRoomId);
  focusedRoomRef.current = focusedRoomId;

  const orbit = useRef<OrbitInput>({
    azimuth: 0.72,
    polar: 0.92,
    distance: 17,
    targetAzimuth: 0.72,
    targetPolar: 0.92,
    targetDistance: 17,
    minDistance: 7,
    maxDistance: 30,
  });

  const startAzimuth = useRef(0);
  const startPolar = useRef(0);
  const startDistance = useRef(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(4)
        .onBegin(() => {
          startAzimuth.current = orbit.current.targetAzimuth;
          startPolar.current = orbit.current.targetPolar;
        })
        .onUpdate((event) => {
          orbit.current.targetAzimuth = startAzimuth.current - event.translationX * 0.0075;
          orbit.current.targetPolar = startPolar.current - event.translationY * 0.005;
        }),
    [],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          startDistance.current = orbit.current.targetDistance;
        })
        .onUpdate((event) => {
          orbit.current.targetDistance = startDistance.current / Math.max(0.3, event.scale);
        }),
    [],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(260)
        .onEnd((event) => {
          const hit = pickRef.current?.(event.x, event.y);
          if (hit) {
            selectDevice(hit.id);
            setPanelOpen(true);
          } else {
            selectDevice(null);
          }
        }),
    [selectDevice],
  );

  const gesture = useMemo(() => Gesture.Exclusive(pan, tapGesture), [pan, tapGesture]);
  const composed = useMemo(() => Gesture.Simultaneous(gesture, pinch), [gesture, pinch]);

  const rooms = snapshot?.rooms ?? [];

  const buildRef = useRef(buildHomeScene(rooms, {
    devicesRef,
    sunRef,
    selectedRef,
    focusedRoomRef,
    orbit,
    kindColors: KIND_COLORS,
  }));

  // Rebuild the scene graph whenever the floor plan changes.
  const planKey = rooms.map((r) => r.id).join('|');
  const lastPlanKey = useRef(planKey);
  if (lastPlanKey.current !== planKey) {
    lastPlanKey.current = planKey;
    buildRef.current = buildHomeScene(rooms, {
      devicesRef,
      sunRef,
      selectedRef,
      focusedRoomRef,
      orbit,
      kindColors: KIND_COLORS,
    });
  }

  const selected = selectedId ? devices[selectedId] : null;

  const weatherIcon = snapshot?.weather.condition === 'rain' ? '🌧' : snapshot?.weather.condition === 'snow' ? '❄️' : snapshot?.weather.condition === 'cloudy' ? '☁️' : '☀️';

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0A1024', '#070A14', '#0A0E1C']} style={StyleSheet.absoluteFill} />

      <GestureDetector gesture={composed}>
        <View style={StyleSheet.absoluteFill}>
          <ThreeCanvas
            input={orbit}
            build={(ctx) => {
              const controller = buildRef.current(ctx);
              pickRef.current = controller.pick ?? null;
              return controller;
            }}
          />
        </View>
      </GestureDetector>

      {/* Top HUD */}
      <View style={[styles.hudTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <GlassCard style={styles.hudCard} intensity={30}>
          <Row style={styles.hudRow}>
            <View style={styles.hudClock}>
              <Text style={styles.clockTime}>{formatMinutes(snapshot?.localMinutes ?? 0)}</Text>
              <Row gap={6}>
                <Text style={styles.clockMeta}>
                  {snapshot?.presence.asleep ? 'Asleep' : snapshot?.presence.home ? 'Home' : 'Away'}
                </Text>
                <View style={[styles.dot, { backgroundColor: snapshot?.presence.home ? colors.green : colors.textFaint }]} />
                <Text style={styles.clockMeta}>{snapshot?.presence.peopleHome ?? 0} in</Text>
              </Row>
            </View>

            <View style={styles.hudWeather}>
              <Text style={styles.weatherIcon}>{weatherIcon}</Text>
              <Text style={styles.weatherTemp}>{snapshot?.weather.outdoorTemp.toFixed(0)}°</Text>
            </View>

            <View style={styles.hudPower}>
              <Text style={styles.powerValue}>{Math.round(liveWatts)}</Text>
              <Text style={styles.powerUnit}>W now</Text>
            </View>
          </Row>

          <View style={styles.hudDivider} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="All rooms" active={focusedRoomId === null} onPress={() => focusRoom(null)} />
            {rooms.map((room) => (
              <Chip
                key={room.id}
                label={room.name}
                color={room.accent}
                count={room.deviceCount}
                active={focusedRoomId === room.id}
                onPress={() => focusRoom(focusedRoomId === room.id ? null : room.id)}
              />
            ))}
          </ScrollView>
        </GlassCard>
      </View>

      {/* Camera controls */}
      <View style={[styles.hudRight, { top: insets.top + 132 }]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          style={styles.roundBtn}
          onPress={() => (orbit.current.targetDistance = orbit.current.minDistance)}
        >
          <Text style={styles.roundGlyph}>＋</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          style={styles.roundBtn}
          onPress={() => (orbit.current.targetDistance = orbit.current.maxDistance)}
        >
          <Text style={styles.roundGlyph}>－</Text>
        </Pressable>
        <Pressable
          style={styles.roundBtn}
          onPress={() => {
            orbit.current.targetAzimuth = orbit.current.azimuth + Math.PI * 0.75;
          }}
        >
          <Text style={styles.roundGlyph}>⟳</Text>
        </Pressable>
      </View>

      {/* Scenes */}
      <View style={[styles.scenes, { bottom: panelOpen && selected ? 330 : insets.bottom + 96 }]} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {scenes.map((scene) => (
            <Pressable key={scene.id} style={[styles.sceneChip, { borderColor: `${scene.accent}66` }]} onPress={() => runScene(scene.id)}>
              <Text style={styles.sceneIcon}>{glyphForScene(scene.icon)}</Text>
              <Text style={styles.sceneLabel}>{scene.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Selected device panel */}
      {selected && panelOpen ? (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(18,26,46,0.96)', 'rgba(9,13,26,0.99)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.panelInner}
          >
            <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse the control panel"
          style={styles.grabber}
          onPress={() => setPanelOpen(false)}
        >
              <View style={styles.grabberBar} />
            </Pressable>

            <Row style={styles.panelHeader}>
              <View
                style={[
                  styles.kindBadge,
                  { backgroundColor: `${kindColor[selected.kind] ?? colors.primary}22`, borderColor: `${kindColor[selected.kind] ?? colors.primary}66` },
                ]}
              >
                <Text style={styles.kindGlyph}>{kindGlyph(selected.kind)}</Text>
              </View>
              <View style={styles.panelTitleBlock}>
                <Text style={styles.panelTitle} numberOfLines={1}>
                  {selected.name}
                </Text>
                <Text style={styles.panelSubtitle} numberOfLines={1}>
                  {selected.roomName ?? 'Unassigned'} · {selected.manufacturer} {selected.model}
                </Text>
              </View>
              <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the control panel"
            onPress={() => setPanelOpen(false)}
            hitSlop={10}
          >
                <Text style={styles.closeGlyph}>✕</Text>
              </Pressable>
            </Row>

            <DeviceControls device={selected} onCommand={command} />

            <Row gap={space.sm}>
              <Pill
                label={`${Math.round(selected.state.powerWatts ?? 0)} W`}
                color={(selected.state.powerWatts ?? 0) > 0 ? colors.amber : colors.textFaint}
              />
              {selected.state.battery !== undefined ? (
                <Pill label={`${Math.round(selected.state.battery)}% battery`} color={colors.teal} />
              ) : null}
              {selected.state.temperature !== undefined ? (
                <Pill label={`${selected.state.temperature.toFixed(1)}°C`} color={colors.cyan} />
              ) : null}
            </Row>
          </LinearGradient>
        </View>
      ) : null}

      {!selected && !panelOpen ? (
        <View style={[styles.hint, { bottom: insets.bottom + 92 }]} pointerEvents="none">
          <Text style={styles.hintText}>Drag to orbit · pinch to zoom · tap a device</Text>
        </View>
      ) : null}

      <StatusBar style="light" />
    </View>
  );
}

function Chip({
  label,
  count,
  color = colors.primary,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[
        styles.chip,
        active ? { backgroundColor: `${color}2E`, borderColor: color } : null,
      ]}
    >
      <Text style={[styles.chipLabel, active ? { color } : null]}>{label}</Text>
      {count !== undefined ? <Text style={styles.chipCount}>{count}</Text> : null}
    </Pressable>
  );
}

/** Kind-specific controls shown in the bottom sheet. */
function DeviceControls({
  device,
  onCommand,
}: {
  device: Device;
  onCommand: (id: string, command: string, args?: Record<string, unknown>) => Promise<void>;
}) {
  const state = device.state;
  const [pending, setPending] = useState(false);

  const run = async (command: string, args?: Record<string, unknown>) => {
    setPending(true);
    await onCommand(device.id, command, args);
    setPending(false);
  };

  switch (device.kind) {
    case 'light':
    case 'fan': {
      const brightness = state.brightness ?? 0;
      const on = state.power === 'on';
      return (
        <View style={styles.controlBlock}>
          <Row style={styles.controlHeader}>
            <Text style={styles.controlLabel}>Brightness</Text>
            <Text style={styles.controlValue}>{Math.round(brightness)}%</Text>
          </Row>
          <View style={styles.stepperRow}>
            {[10, 40, 70, 100].map((level) => (
              <Pressable
                key={level}
                disabled={pending}
                onPress={() => run('setBrightness', { value: level })}
                style={[styles.stepper, on && brightness === level ? styles.stepperActive : null]}
              >
                <Text style={[styles.stepperText, on && brightness === level ? styles.stepperTextActive : null]}>{level}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={`${device.name} power`}
              accessibilityState={{ checked: on, disabled: pending }}
              disabled={pending}
              onPress={() => run('toggle')}
              style={[styles.stepper, styles.stepperWide, on && styles.stepperActiveOn]}
            >
              <Text style={[styles.stepperText, on && styles.stepperTextActive]}>{on ? 'Off' : 'On'}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    case 'thermostat':
    case 'thermostat_valve': {
      const target = state.targetTemperature ?? 21;
      const temp = state.temperature ?? target;
      return (
        <View style={styles.controlBlock}>
          <Row style={styles.thermoRow}>
            <Pressable disabled={pending} style={styles.thermoBtn} onPress={() => run('setTargetTemperature', { value: target - 0.5 })}>
              <Text style={styles.thermoGlyph}>−</Text>
            </Pressable>
            <View style={styles.thermoCenter}>
              <Text style={styles.thermoNow}>{temp.toFixed(1)}°</Text>
              <Text style={styles.thermoTarget}>target {target.toFixed(1)}° · {state.mode ?? 'heat'}</Text>
            </View>
            <Pressable disabled={pending} style={styles.thermoBtn} onPress={() => run('setTargetTemperature', { value: target + 0.5 })}>
              <Text style={styles.thermoGlyph}>＋</Text>
            </Pressable>
          </Row>
        </View>
      );
    }

    case 'lock': {
      const locked = state.locked ?? false;
      return (
        <View style={styles.controlBlock}>
          <Row gap={space.sm}>
            <Pressable
            accessibilityRole="button"
            accessibilityLabel="Unlock"
            disabled={pending}
            onPress={() => run('unlock')}
            style={[styles.wideBtn, !locked && styles.wideBtnActive]}
          >
              <Text style={[styles.wideBtnText, !locked && styles.wideBtnTextActive]}>Unlock</Text>
            </Pressable>
            <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lock"
            accessibilityState={{ selected: locked }}
            disabled={pending}
            onPress={() => run('lock')}
            style={[styles.wideBtn, locked && styles.wideBtnActive]}
          >
              <Text style={[styles.wideBtnText, locked && styles.wideBtnTextActive]}>Lock</Text>
            </Pressable>
          </Row>
        </View>
      );
    }

    case 'blinds': {
      const position = state.position ?? 0;
      return (
        <View style={styles.controlBlock}>
          <Row style={styles.controlHeader}>
            <Text style={styles.controlLabel}>Position</Text>
            <Text style={styles.controlValue}>{Math.round(position)}%</Text>
          </Row>
          <Bar value={position} color={colors.primarySoft} height={8} />
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            {[0, 50, 100].map((value) => (
              <Pressable key={value} disabled={pending} onPress={() => run('setPosition', { value })} style={styles.stepper}>
                <Text style={styles.stepperText}>{value === 0 ? 'Closed' : value === 100 ? 'Open' : 'Half'}</Text>
              </Pressable>
            ))}
          </Row>
        </View>
      );
    }

    case 'tv':
    case 'speaker': {
      const volume = state.volume ?? 0;
      return (
        <View style={styles.controlBlock}>
          <Row style={styles.controlHeader}>
            <Text style={styles.controlLabel}>{device.kind === 'tv' ? (state.playing ?? 'Idle') : 'Volume'}</Text>
            <Text style={styles.controlValue}>{Math.round(volume)}</Text>
          </Row>
          <Bar value={volume} max={100} color={colors.pink} height={8} />
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            {[20, 50, 80].map((value) => (
              <Pressable key={value} disabled={pending} onPress={() => run('setVolume', { value })} style={styles.stepper}>
                <Text style={styles.stepperText}>{value}</Text>
              </Pressable>
            ))}
          </Row>
        </View>
      );
    }

    case 'plug':
    case 'vacuum':
    case 'garage': {
      const on = state.power === 'on' || state.open === true;
      return (
        <View style={styles.controlBlock}>
          <Pressable disabled={pending} onPress={() => run('toggle')} style={[styles.wideBtn, on && styles.wideBtnActive]}>
            <Text style={[styles.wideBtnText, on && styles.wideBtnTextActive]}>{on ? 'Turn off' : 'Turn on'}</Text>
          </Pressable>
        </View>
      );
    }

    case 'camera':
    case 'doorbell': {
      return (
        <View style={styles.controlBlock}>
          <Row gap={space.sm}>
            <Pill label={state.recording ? 'Recording' : 'Idle'} color={state.recording ? colors.red : colors.textFaint} filled={state.recording} />
            {state.motionDetected ? <Pill label="Motion" color={colors.amber} /> : null}
            {state.lastMotionAt ? <Pill label={`Last seen ${new Date(state.lastMotionAt).toLocaleTimeString()}`} color={colors.textFaint} /> : null}
          </Row>
        </View>
      );
    }

    default: {
      return (
        <View style={styles.controlBlock}>
          <Row gap={space.lg} style={styles.sensorRow}>
            {state.temperature !== undefined ? <Metric label="Temp" value={state.temperature.toFixed(1)} unit="°C" color={colors.cyan} /> : null}
            {state.humidity !== undefined ? <Metric label="Humidity" value={Math.round(state.humidity)} unit="%" color={colors.teal} /> : null}
            {state.co2 !== undefined ? <Metric label="CO₂" value={Math.round(state.co2)} unit="ppm" color={state.co2 > 1000 ? colors.amber : colors.text} /> : null}
            {state.voc !== undefined ? <Metric label="VOC" value={Math.round(state.voc)} unit="ppb" color={colors.primary} /> : null}
            {state.pm25 !== undefined ? <Metric label="PM2.5" value={Math.round(state.pm25)} unit="µg/m³" color={state.pm25 > 20 ? colors.amber : colors.text} /> : null}
            {state.motion !== undefined ? <Metric label="Motion" value={state.motion ? 'Yes' : 'No'} color={state.motion ? colors.amber : colors.textDim} /> : null}
            {state.leak !== undefined ? <Metric label="Leak" value={state.leak ? 'Detected' : 'Dry'} color={state.leak ? colors.red : colors.green} /> : null}
            {state.battery !== undefined ? <Metric label="Battery" value={Math.round(state.battery)} unit="%" color={colors.teal} /> : null}
          </Row>
        </View>
      );
    }
  }
}

function kindGlyph(kind: Device['kind']): string {
  switch (kind) {
    case 'light':
      return '💡';
    case 'thermostat':
      return '🌡';
    case 'lock':
      return '🔒';
    case 'camera':
      return '📷';
    case 'sensor_motion':
      return '🚨';
    case 'sensor_leak':
      return '💧';
    case 'sensor_contact':
      return '🚪';
    case 'plug':
      return '🔌';
    case 'speaker':
      return '🔊';
    case 'tv':
      return '📺';
    case 'blinds':
      return '🪟';
    case 'fan':
      return '🌀';
    case 'air_quality':
      return '🌬';
    case 'doorbell':
      return '🔔';
    case 'garage':
      return '🚗';
    case 'vacuum':
      return '🤖';
    default:
      return '•';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hudTop: { position: 'absolute', left: space.md, right: space.md },
  hudCard: { padding: space.md, gap: space.sm },
  hudRow: { justifyContent: 'space-between' },
  hudClock: { gap: 2 },
  clockTime: { fontSize: 26, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  clockMeta: { ...type.tiny, color: colors.textDim },
  dot: { width: 5, height: 5, borderRadius: 3 },
  hudWeather: { alignItems: 'center', gap: 2 },
  weatherIcon: { fontSize: 20 },
  weatherTemp: { ...type.small, color: colors.textDim },
  hudPower: { alignItems: 'flex-end' },
  powerValue: { fontSize: 22, fontWeight: '700', color: colors.amber, letterSpacing: -0.4 },
  powerUnit: { ...type.tiny, color: colors.textFaint },
  hudDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSoft },
  chipRow: { gap: space.sm, paddingVertical: 2, paddingRight: space.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(18,26,46,0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  chipLabel: { ...type.small, color: colors.textDim },
  chipCount: { ...type.tiny, color: colors.textFaint },
  hudRight: { position: 'absolute', right: space.md, gap: space.sm },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(13,18,34,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundGlyph: { color: colors.textDim, fontSize: 16 },
  scenes: { position: 'absolute', left: space.md, right: space.md },
  sceneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(13,18,34,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  sceneIcon: { fontSize: 15 },
  sceneLabel: { ...type.small, color: colors.text },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panelInner: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grabber: { alignItems: 'center', paddingVertical: 6 },
  grabberBar: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border },
  panelHeader: { justifyContent: 'space-between' },
  kindBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  kindGlyph: { fontSize: 19 },
  panelTitleBlock: { flex: 1, gap: 2 },
  panelTitle: { ...type.section, color: colors.text },
  panelSubtitle: { ...type.tiny, color: colors.textFaint },
  closeGlyph: { color: colors.textFaint, fontSize: 15, paddingHorizontal: 4 },
  controlBlock: { gap: space.sm },
  controlHeader: { justifyContent: 'space-between' },
  controlLabel: { ...type.small, color: colors.textDim },
  controlValue: { ...type.small, color: colors.text, fontWeight: '700' },
  stepperRow: { gap: space.sm },
  stepper: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  stepperWide: { flex: 1.2 },
  stepperActive: { backgroundColor: 'rgba(91,141,239,0.3)', borderColor: colors.primary },
  stepperActiveOn: { backgroundColor: 'rgba(61,220,151,0.28)', borderColor: colors.green },
  stepperText: { ...type.small, color: colors.textDim },
  stepperTextActive: { color: colors.text, fontWeight: '700' },
  thermoRow: { justifyContent: 'space-between' },
  thermoBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  thermoGlyph: { fontSize: 22, color: colors.text },
  thermoCenter: { alignItems: 'center', gap: 2 },
  thermoNow: { fontSize: 34, fontWeight: '700', color: colors.text, letterSpacing: -1 },
  thermoTarget: { ...type.tiny, color: colors.textFaint },
  wideBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  wideBtnActive: { backgroundColor: 'rgba(61,220,151,0.24)', borderColor: colors.green },
  wideBtnText: { ...type.body, color: colors.textDim, fontWeight: '700' },
  wideBtnTextActive: { color: colors.green },
  sensorRow: { flexWrap: 'wrap', gap: space.lg },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: { ...type.tiny, color: colors.textFaint },
});