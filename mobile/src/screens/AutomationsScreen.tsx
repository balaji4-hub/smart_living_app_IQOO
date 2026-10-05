import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../api/store';
import type { Automation, Device, DeviceKind } from '../api/types';
import { colors, radius, space, type } from '../theme';
import { Card, EmptyState, Pill, Row, ScreenScroll, SectionHeader, tap } from '../components/ui';

const TRIGGER_LABELS: Record<string, string> = {
  device_state: 'A device switches state (power, lock, contact)',
  device_metric: 'A device reading passes a threshold',
  time_of_day: 'The clock reaches a time',
  sun_event: 'Dawn, dusk or late night',
  presence: 'People arrive or leave',
  weather: 'Weather or outdoor temperature',
};

const SUN_EVENT_LABELS: Record<string, string> = {
  '0': 'midnight',
  '6': 'dawn',
  '18': 'dusk',
  '22': 'late night',
};

export function AutomationsScreen() {
  const insets = useSafeAreaInsets();
  const refreshAll = useApp((s) => s.refreshAutomations);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const automations = useApp((s) => s.automations);
  const toggleAutomation = useApp((s) => s.toggleAutomation);
  const runAutomation = useApp((s) => s.runAutomation);
  const removeAutomation = useApp((s) => s.removeAutomation);
  const createAutomation = useApp((s) => s.createAutomation);
  const devices = useApp((s) => s.devices);

  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const list = automations.filter((a) => (filter === 'all' ? true : filter === 'on' ? a.enabled : !a.enabled));

  const quickCreate = async () => {
    const lights = Object.values(devices).filter((d) => d.kind === 'light');
    const target = lights[0];
    if (!target) return;
    await createAutomation({
      name: 'Hallway light at dusk',
      description: 'Created from the Automations tab',
      enabled: true,
      trigger: { kind: 'sun_event', op: 'eq', value: 18 },
      conditions: [],
      actions: [{ deviceId: target.id, command: 'turnOn' }],
    });
  };

  return (
    <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <Row style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Automations</Text>
          <Text style={styles.subtitle}>{automations.filter((a) => a.enabled).length} active of {automations.length}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a sample automation"
          style={styles.addBtn}
          onPress={quickCreate}
        >
          <Text style={styles.addGlyph}>+</Text>
        </Pressable>
      </Row>

      <Row gap={space.sm}>
        {(['all', 'on', 'off'] as const).map((key) => (
          <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filter, filter === key && styles.filterActive]}>
            <Text style={[styles.filterText, filter === key && styles.filterTextActive]}>
              {key === 'all' ? 'All' : key === 'on' ? 'Active' : 'Paused'}
            </Text>
          </Pressable>
        ))}
      </Row>

      {list.length === 0 ? (
        <EmptyState icon="🤖" title="No automations here" body="Create one and the simulator will start reacting on its own." />
      ) : (
        list.map((automation) => (
          <Card key={automation.id} accent={automation.enabled ? colors.green : colors.textFaint}>
            <Row style={styles.header}>
              <View style={styles.flex}>
                <Text style={styles.name}>{automation.name}</Text>
                {automation.description ? <Text style={styles.description}>{automation.description}</Text> : null}
              </View>
              <Pressable
                onPress={() => {
                  tap();
                  toggleAutomation(automation.id, !automation.enabled);
                }}
                style={[styles.toggle, automation.enabled && styles.toggleOn]}
              >
                <View style={[styles.knob, automation.enabled && styles.knobOn]} />
              </Pressable>
            </Row>

            <View style={styles.logic}>
              <LogicRow label="WHEN" value={describeTrigger(automation, devices)} color={colors.primary} />
              {automation.conditions.length ? (
                <LogicRow label="IF" value={automation.conditions.map(describeCondition).join(' · ')} color={colors.amber} />
              ) : null}
              <LogicRow label="THEN" value={automation.actions.map(describeAction).join(' · ')} color={colors.teal} />
            </View>

            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Pill label={`run ${automation.run_count}×`} color={colors.textFaint} />
              {automation.last_run_at ? <Pill label={`last ${formatAgo(automation.last_run_at)}`} color={colors.textFaint} /> : <Pill label="never run" color={colors.textFaint} />}
            </Row>

            <Row gap={space.sm}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Run ${automation.name} now`}
                style={styles.smallBtn}
                onPress={() => runAutomation(automation.id)}
              >
                <Text style={styles.smallBtnText}>Run now</Text>
              </Pressable>
              <Pressable
                style={[styles.smallBtn, confirmId === automation.id && styles.dangerBtn]}
                onPress={() => {
                  if (confirmId === automation.id) removeAutomation(automation.id);
                  else setConfirmId(automation.id);
                }}
              >
                <Text style={[styles.smallBtnText, confirmId === automation.id && { color: colors.red }]}>
                  {confirmId === automation.id ? 'Tap again to delete' : 'Delete'}
                </Text>
              </Pressable>
            </Row>
          </Card>
        ))
      )}

      <SectionHeader title="Supported triggers" />
      <Card>
        {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
          <Row key={key} style={styles.supportedRow}>
            <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
            <Text style={styles.supportedText}>{label}</Text>
          </Row>
        ))}
      </Card>
    </ScreenScroll>
  );
}

function LogicRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Row gap={space.sm} style={styles.logicRow}>
      <View style={[styles.logicTag, { borderColor: `${color}66` }]}>
        <Text style={[styles.logicTagText, { color }]}>{label}</Text>
      </View>
      <Text style={styles.logicValue}>{value}</Text>
    </Row>
  );
}

function describeTrigger(automation: Automation, devices: Record<string, Device>): string {
  const t = automation.trigger;
  const scope = t.deviceId
    ? devices[t.deviceId]?.name ?? 'a device'
    : t.deviceKind
      ? `every ${humanKind(t.deviceKind)}`
      : 'the home';

  switch (t.kind) {
    case 'time_of_day':
      return `it is ${formatMinutesLabel(Number(t.value))}`;
    case 'sun_event':
      return `it is ${SUN_EVENT_LABELS[String(t.value)] ?? String(t.value)}`;
    case 'presence':
      return t.value === 'away' ? 'nobody is home' : 'someone is home';
    case 'weather':
      if (typeof t.value === 'string') return `the weather is ${t.value}`;
      return `${t.metric ?? 'outdoorTemp'} is ${OP_LABELS[t.op] ?? t.op} ${t.value}`;
    case 'device_metric':
      return `${scope} ${t.metric ?? 'reading'} ${OP_LABELS[t.op] ?? t.op} ${formatValue(t.value)}`;
    case 'device_state':
    default:
      return `${scope} is ${String(t.value)}`;
  }
}

function describeCondition(condition: Record<string, unknown>): string {
  const metric = String(condition.metric ?? 'state');
  const op = OP_LABELS[String(condition.op)] ?? String(condition.op);
  return `${metric} ${op} ${formatValue(condition.value as string | number)}`;
}

const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is above',
  gte: 'is at least',
  lt: 'is below',
  lte: 'is at most',
  between: 'is between',
  changed: 'changes',
};

function humanKind(kind: string): string {
  return kind.replace(/_/g, ' ');
}

function formatValue(value: unknown): string {
  if (value === true) return 'on';
  if (value === false) return 'off';
  if (typeof value === 'number') return String(Math.round(value * 10) / 10);
  return String(value);
}

function describeAction(action: Automation['actions'][number]): string {
  const args = action.args ? Object.entries(action.args).map(([k, v]) => `${k} ${String(v)}`).join(' ') : '';
  return `${action.command}${args ? ` (${args})` : ''}`;
}

function formatMinutesLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(Math.floor(m % 60)).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}`;
}

function formatAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { justifyContent: 'space-between', gap: space.md },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint, marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGlyph: { color: colors.primarySoft, fontSize: 20 },
  filter: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  filterActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  filterText: { ...type.small, color: colors.textDim },
  filterTextActive: { color: colors.text, fontWeight: '700' },
  name: { ...type.section, color: colors.text },
  description: { ...type.tiny, color: colors.textFaint, marginTop: 2 },
  toggle: {
    width: 46,
    height: 27,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    padding: 3,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  toggleOn: { backgroundColor: 'rgba(61,220,151,0.4)', borderColor: colors.green },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: colors.textFaint },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.green },
  logic: { gap: space.sm },
  logicRow: { alignItems: 'flex-start' },
  logicTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 1,
  },
  logicTagText: { ...type.tiny, fontSize: 9 },
  logicValue: { ...type.small, color: colors.textDim, flex: 1, lineHeight: 18 },
  smallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  dangerBtn: { borderColor: `${colors.red}66` },
  smallBtnText: { ...type.tiny, color: colors.textDim },
  supportedRow: { gap: space.sm },
  bullet: { width: 6, height: 6, borderRadius: 3 },
  supportedText: { ...type.small, color: colors.textDim },
});