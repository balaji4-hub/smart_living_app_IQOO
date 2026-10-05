import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currencySymbol, useApp } from '../api/store';
import type { Device, DeviceKind } from '../api/types';
import type { TabParamList } from '../navigation/RootNavigator';
import { colors, kindColor, radius, space, type } from '../theme';
import { Bar, Card, EmptyState, Metric, Pill, Row, ScreenScroll, SectionHeader, tap } from '../components/ui';

const KIND_OPTIONS: Array<{ kind: DeviceKind; label: string; glyph: string }> = [
  { kind: 'light', label: 'Light', glyph: '💡' },
  { kind: 'thermostat', label: 'Climate', glyph: '🌡' },
  { kind: 'lock', label: 'Lock', glyph: '🔒' },
  { kind: 'camera', label: 'Camera', glyph: '📷' },
  { kind: 'sensor_motion', label: 'Motion', glyph: '🚨' },
  { kind: 'sensor_leak', label: 'Leak', glyph: '💧' },
  { kind: 'plug', label: 'Plug', glyph: '🔌' },
  { kind: 'speaker', label: 'Speaker', glyph: '🔊' },
  { kind: 'tv', label: 'TV', glyph: '📺' },
  { kind: 'blinds', label: 'Blinds', glyph: '🪟' },
  { kind: 'fan', label: 'Fan', glyph: '🌀' },
  { kind: 'air_quality', label: 'Air', glyph: '🌬' },
  { kind: 'vacuum', label: 'Vacuum', glyph: '🤖' },
];

type Filter = 'all' | 'on' | 'favorites' | DeviceKind;

export function DevicesScreen() {
  const insets = useSafeAreaInsets();
  const refreshAll = useApp((s) => s.refreshAll);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const devices = useApp((s) => s.devices);
  const snapshot = useApp((s) => s.snapshot);
  const command = useApp((s) => s.command);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const addDevice = useApp((s) => s.addDevice);
  const selectDevice = useApp((s) => s.selectDevice);
  const removeDevice = useApp((s) => s.removeDevice);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<DeviceKind>('light');
  const [newRoom, setNewRoom] = useState<string | null>(null);

  const list = useMemo(() => {
    const all = Object.values(devices);
    const q = query.trim().toLowerCase();
    return all
      .filter((d) => {
        if (filter === 'on' && d.state.power !== 'on') return false;
        if (filter === 'favorites' && !d.favorite) return false;
        if (filter !== 'all' && filter !== 'on' && filter !== 'favorites' && d.kind !== filter) return false;
        if (q && !d.name.toLowerCase().includes(q) && !(d.roomName ?? '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  }, [devices, filter, query]);

  const totals = useMemo(() => {
    const all = Object.values(devices);
    return {
      total: all.length,
      on: all.filter((d) => d.state.power === 'on').length,
      favorites: all.filter((d) => d.favorite).length,
      watts: all.reduce((sum, d) => sum + (d.state.powerWatts ?? 0), 0),
      cost: all.reduce((sum, d) => sum + (d.state.powerWatts ?? 0), 0) / 1000 * (snapshot ? 0.28 : 0.28),
    };
  }, [devices, snapshot]);

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: `All ${totals.total}` },
    { key: 'on', label: `On ${totals.on}` },
    { key: 'favorites', label: `★ ${totals.favorites}` },
  ];

  return (
    <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <Row style={styles.header}>
        <View>
          <Text style={styles.title}>Devices</Text>
          <Text style={styles.subtitle}>{list.length} shown</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={adding ? 'Cancel adding a device' : 'Add a device'}
          style={styles.addBtn}
          onPress={() => setAdding((v) => !v)}
        >
          <Text style={styles.addGlyph}>{adding ? '✕' : '+'}</Text>
        </Pressable>
      </Row>

      <Card style={styles.summaryCard}>
        <Row style={styles.summaryRow}>
          <Metric label="Live draw" value={Math.round(totals.watts)} unit="W" color={colors.amber} />
          <View style={styles.vline} />
          <Metric label="Running" value={totals.on} unit={`of ${totals.total}`} color={colors.green} />
          <View style={styles.vline} />
          <Metric label="Est. cost" value={`${currencySymbol('USD')}${totals.cost.toFixed(2)}`} unit="/hr" color={colors.primarySoft} />
        </Row>
      </Card>

      {adding ? (
        <Card accent={colors.primary}>
          <Text style={styles.cardLabel}>Pair a new device</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Device name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
            {KIND_OPTIONS.map((option) => (
              <Pressable
                key={option.kind}
                onPress={() => setNewKind(option.kind)}
                style={[styles.kindChip, newKind === option.kind && styles.kindChipActive]}
              >
                <Text style={styles.kindGlyph}>{option.glyph}</Text>
                <Text style={[styles.kindLabel, newKind === option.kind && styles.kindLabelActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
            {(snapshot?.rooms ?? []).map((room) => (
              <Pressable
                key={room.id}
                onPress={() => setNewRoom(room.id)}
                style={[styles.kindChip, newRoom === room.id && styles.kindChipActive]}
              >
                <View style={[styles.roomDot, { backgroundColor: room.accent }]} />
                <Text style={[styles.kindLabel, newRoom === room.id && styles.kindLabelActive]}>{room.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              await addDevice({ name: newName.trim() || `${KIND_OPTIONS.find((k) => k.kind === newKind)?.label} ${list.length + 1}`, kind: newKind, roomId: newRoom });
              setNewName('');
              setAdding(false);
            }}
          >
            <Text style={styles.primaryBtnText}>Pair device</Text>
          </Pressable>
        </Card>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search devices or rooms"
        placeholderTextColor={colors.textFaint}
        style={styles.search}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filters.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setFilter(item.key)}
            style={[styles.filter, filter === item.key && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <SectionHeader title="All devices" />

      {list.length === 0 ? (
        <EmptyState icon="🔌" title="Nothing matches" body="Try another filter, or pair a new device to bring this room to life." />
      ) : (
        list.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            expanded={expanded === device.id}
            onToggleExpand={() => setExpanded(expanded === device.id ? null : device.id)}
            onTogglePower={() => command(device.id, 'toggle')}
            onFavorite={() => toggleFavorite(device.id)}
            onLocate={() => {
              // Selecting alone is invisible from this tab, so jump to the 3D view.
              selectDevice(device.id);
              navigation.navigate('Home');
            }}
            onRemove={() => removeDevice(device.id)}
          />
        ))
      )}
    </ScreenScroll>
  );
}

function DeviceRow({
  device,
  expanded,
  onToggleExpand,
  onTogglePower,
  onFavorite,
  onLocate,
  onRemove,
}: {
  device: Device;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePower: () => void;
  onFavorite: () => void;
  onLocate: () => void;
  onRemove: () => void;
}) {
  const color = kindColor[device.kind] ?? colors.primary;
  const on = device.state.power === 'on';
  const canToggle = ['light', 'fan', 'plug', 'tv', 'speaker', 'vacuum', 'garage'].includes(device.kind);

  return (
    <Card accent={on ? color : undefined}>
      <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${device.name}, ${on ? 'on' : 'off'}, ${device.roomName}`}
      accessibilityHint="Shows or hides the detailed controls"
      accessibilityState={{ expanded }}
      onPress={onToggleExpand}
      onPressIn={() => tap()}
    >
        <Row style={styles.deviceRow}>
          <View style={[styles.deviceBadge, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
            <Text style={styles.deviceGlyph}>{glyphFor(device.kind)}</Text>
          </View>

          <View style={styles.deviceText}>
            <Row gap={6}>
              <Text style={styles.deviceName} numberOfLines={1}>
                {device.name}
              </Text>
              {device.favorite ? <Text style={styles.star}>★</Text> : null}
            </Row>
            <Text style={styles.deviceMeta} numberOfLines={1}>
              {device.roomName ?? 'Unassigned'} · {Math.round(device.state.powerWatts ?? 0)} W
              {device.state.battery !== undefined ? ` · ${Math.round(device.state.battery)}%` : ''}
            </Text>
          </View>

          <Pill
            label={statusLabel(device)}
            color={statusColor(device)}
            filled={on || Boolean(device.state.motion) || Boolean(device.state.leak)}
          />

          {canToggle ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={`${device.name} power`}
              accessibilityState={{ checked: on }}
              accessibilityHint={on ? 'Turns the device off' : 'Turns the device on'}
              onPress={onTogglePower}
              style={[styles.switch, on && { backgroundColor: color }]}
            >
              <View style={[styles.knob, on && styles.knobOn]} />
            </Pressable>
          ) : null}
        </Row>
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          {device.state.brightness !== undefined ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Brightness</Text>
              <View style={styles.detailBar}>
                <Bar value={device.state.brightness} color={color} />
              </View>
              <Text style={styles.detailValue}>{Math.round(device.state.brightness)}%</Text>
            </View>
          ) : null}

          {device.state.temperature !== undefined ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Temperature</Text>
              <View style={styles.detailBar}>
                <Bar
                  value={device.state.temperature}
                  min={-10}
                  max={40}
                  color={colors.cyan}
                />
              </View>
              <Text style={styles.detailValue}>{device.state.temperature.toFixed(1)}°C</Text>
            </View>
          ) : null}

          {device.state.co2 !== undefined ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>CO₂</Text>
              <View style={styles.detailBar}>
                <Bar value={device.state.co2} max={2000} color={colors.teal} />
              </View>
              <Text style={styles.detailValue}>{Math.round(device.state.co2)}</Text>
            </View>
          ) : null}

          <Row gap={space.sm} style={{ marginTop: space.xs, flexWrap: 'wrap' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${device.name} in the 3D view`}
              style={styles.smallBtn}
              onPress={onLocate}
            >
              <Text style={styles.smallBtnText}>Show in 3D</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${device.favorite ? 'Remove' : 'Add'} ${device.name} ${device.favorite ? 'from' : 'to'} favourites`}
              accessibilityState={{ selected: !!device.favorite }}
              style={styles.smallBtn}
              onPress={onFavorite}
            >
              <Text style={styles.smallBtnText}>{device.favorite ? 'Unfavourite' : 'Favourite'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${device.name}`}
              style={[styles.smallBtn, styles.dangerBtn]}
              onPress={onRemove}
            >
              <Text style={[styles.smallBtnText, { color: colors.red }]}>Remove</Text>
            </Pressable>
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

function statusLabel(device: Device): string {
  const s = device.state;
  if (s.leak) return 'LEAK';
  if (s.motion) return 'MOTION';
  if (s.open === true) return 'OPEN';
  if (s.locked !== undefined) return s.locked ? 'LOCKED' : 'UNLOCKED';
  if (s.recording) return 'REC';
  if (s.powerWatts !== undefined && (s.powerWatts ?? 0) > 0) return `${Math.round(s.powerWatts ?? 0)}W`;
  return s.power === 'on' ? 'ON' : 'OFF';
}

function statusColor(device: Device): string {
  const s = device.state;
  if (s.leak) return colors.red;
  if (s.motion) return colors.amber;
  if (s.open === true) return colors.amber;
  if (s.locked !== undefined) return s.locked ? colors.green : colors.orange;
  if ((s.powerWatts ?? 0) > 0) return colors.amber;
  return s.power === 'on' ? colors.green : colors.textFaint;
}

function glyphFor(kind: DeviceKind): string {
  return (
    {
      light: '💡',
      thermostat: '🌡',
      lock: '🔒',
      camera: '📷',
      sensor_motion: '🚨',
      sensor_leak: '💧',
      sensor_contact: '🚪',
      plug: '🔌',
      speaker: '🔊',
      tv: '📺',
      blinds: '🪟',
      fan: '🌀',
      air_quality: '🌬',
      doorbell: '🔔',
      garage: '🚗',
      vacuum: '🤖',
      thermostat_valve: '🌡',
    }[kind] ?? '•'
  );
}

const styles = StyleSheet.create({
  header: { justifyContent: 'space-between' },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint },
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
  summaryCard: { paddingVertical: space.md },
  summaryRow: { justifyContent: 'space-between' },
  vline: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: colors.borderSoft },
  cardLabel: { ...type.small, color: colors.textDim },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.text,
    ...type.body,
  },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { ...type.section, color: colors.bg },
  kindRow: { gap: space.sm, paddingVertical: 2 },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  kindChipActive: { backgroundColor: 'rgba(91,141,239,0.28)', borderColor: colors.primary },
  kindGlyph: { fontSize: 14 },
  kindLabel: { ...type.small, color: colors.textDim },
  kindLabelActive: { color: colors.text, fontWeight: '700' },
  roomDot: { width: 8, height: 8, borderRadius: 4 },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: 13,
    color: colors.text,
    ...type.body,
  },
  filterRow: { gap: space.sm },
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
  deviceRow: { gap: space.md },
  deviceBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  deviceGlyph: { fontSize: 18 },
  deviceText: { flex: 1, gap: 2 },
  deviceName: { ...type.body, color: colors.text, fontWeight: '600', flexShrink: 1 },
  star: { color: colors.amber, fontSize: 11 },
  deviceMeta: { ...type.tiny, color: colors.textFaint },
  switch: {
    width: 46,
    height: 27,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    padding: 3,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: colors.textFaint },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.bg },
  detail: { gap: space.sm, marginTop: space.xs },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  detailLabel: { ...type.tiny, color: colors.textFaint, width: 78 },
  detailBar: { flex: 1 },
  detailValue: { ...type.tiny, color: colors.textDim, width: 52, textAlign: 'right' },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  dangerBtn: { borderColor: `${colors.red}55` },
  smallBtnText: { ...type.tiny, color: colors.textDim },
});