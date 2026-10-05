import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../api/store';
import type { Device, DeviceKind, Scene } from '../api/types';
import { colors, radius, space, type } from '../theme';
import { Card, Pill, Row, ScreenScroll, SectionHeader, tap } from '../components/ui';
import { glyphForScene } from '../icons';

export function ScenesScreen() {
  const insets = useSafeAreaInsets();
  const refreshAll = useApp((s) => s.refreshScenes);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const scenes = useApp((s) => s.scenes);
  const runScene = useApp((s) => s.runScene);
  const devices = useApp((s) => s.devices);
  const [runningId, setRunningId] = useState<string | null>(null);

  const run = async (scene: Scene) => {
    setRunningId(scene.id);
    await runScene(scene.id);
    setTimeout(() => setRunningId(null), 700);
  };

  return (
    <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <View>
        <Text style={styles.title}>Scenes</Text>
        <Text style={styles.subtitle}>One tap sets the whole house</Text>
      </View>

      {scenes.map((scene) => {
        const kinds = collectKinds(scene);
        const targets = resolveTargets(scene, devices);
        const preview = [...targets].slice(0, 4);

        return (
          <Card key={scene.id} accent={scene.accent}>
            <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Run the ${scene.name} scene`}
        accessibilityHint={`Applies ${scene.actions.length} device changes`}
        onPress={() => run(scene)}
        onPressIn={() => tap()}
      >
              <Row style={styles.sceneHeader}>
                <LinearGradient
                  colors={[`${scene.accent}44`, `${scene.accent}11`]}
                  style={styles.sceneIcon}
                >
                  <Text style={styles.sceneGlyph}>{glyphForScene(scene.icon)}</Text>
                </LinearGradient>

                <View style={styles.sceneText}>
                  <Text style={styles.sceneName}>{scene.name}</Text>
                  <Text style={styles.sceneMeta}>
                    {kinds.size} kind{kinds.size === 1 ? '' : 's'} · {targets.length} device
                    {targets.length === 1 ? '' : 's'} · run {scene.run_count}×
                    {scene.last_run_at ? ` · last ${relativeTime(scene.last_run_at)}` : ' · never run'}
                  </Text>
                </View>

                <View style={[styles.runBtn, runningId === scene.id && styles.runBtnBusy]}>
                  <Text style={styles.runGlyph}>{runningId === scene.id ? '•••' : '▶'}</Text>
                </View>
              </Row>
            </Pressable>

            {preview.length ? (
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                {preview.map((device) => (
                  <Pill key={device.id} label={device.name} color={scene.accent} />
                ))}
                {targets.length > preview.length ? <Pill label={`+${targets.length - preview.length}`} color={colors.textFaint} /> : null}
              </Row>
            ) : null}
          </Card>
        );
      })}

      <SectionHeader title="How scenes work" />
      <Card>
        <Text style={styles.explain}>
          Scenes run their actions in order against the live simulator, so the 3D house, energy totals and automations all react
          immediately. Automations trigger themselves from device state, time of day, sun position, presence and weather.
        </Text>
      </Card>
    </ScreenScroll>
  );
}

/** Scene actions target either a specific device or a whole device kind. */
function collectKinds(scene: Scene): Set<string> {
  const out = new Set<string>();
  for (const action of scene.actions) {
    const kind = (action as { deviceKind?: string }).deviceKind;
    if (typeof kind === 'string') out.add(kind);
  }
  return out;
}

/** Resolves the concrete devices a scene will touch, for the preview pills. */
function resolveTargets(scene: Scene, devices: Record<string, Device>): Device[] {
  const out: Device[] = [];
  const seen = new Set<string>();

  for (const action of scene.actions) {
    const direct = (action as { deviceId?: string }).deviceId;
    if (typeof direct === 'string' && devices[direct] && !seen.has(direct)) {
      seen.add(direct);
      out.push(devices[direct]);
      continue;
    }
    const kind = (action as { deviceKind?: DeviceKind }).deviceKind;
    if (typeof kind === 'string') {
      for (const device of Object.values(devices)) {
        if (device.kind === kind && !seen.has(device.id)) {
          seen.add(device.id);
          out.push(device);
        }
      }
    }
  }
  return out;
}

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint, marginTop: 2 },
  sceneHeader: { gap: space.md },
  sceneIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  sceneGlyph: { fontSize: 24 },
  sceneText: { flex: 1, gap: 3 },
  sceneName: { ...type.section, color: colors.text },
  sceneMeta: { ...type.tiny, color: colors.textFaint },
  runBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  runBtnBusy: { backgroundColor: 'rgba(61,220,151,0.25)', borderColor: colors.green },
  runGlyph: { color: colors.text, fontSize: 15 },
  explain: { ...type.small, color: colors.textDim, lineHeight: 20 },
});