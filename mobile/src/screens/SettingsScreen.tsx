import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BASE_URL } from '../api/client';
import { formatMinutes, useApp } from '../api/store';
import { colors, radius, space, type } from '../theme';
import { Card, Divider, Metric, Pill, Row, ScreenScroll, SectionHeader } from '../components/ui';

const SCALES = [1, 10, 60, 300, 600];

export function SettingsScreen() {
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

  const profile = useApp((s) => s.profile);
  const snapshot = useApp((s) => s.snapshot);
  const sim = useApp((s) => s.sim);
  const setTimeScale = useApp((s) => s.setTimeScale);
  const logout = useApp((s) => s.logout);
  const refreshSim = useApp((s) => s.refreshSim);
  const events = useApp((s) => s.events);
  const devices = useApp((s) => s.devices);

  const [confirmLogout, setConfirmLogout] = useState(false);

  const scale = sim?.scale ?? 60;
  const totals = Object.values(devices).reduce(
    (acc, d) => ({ watts: acc.watts + (d.state.powerWatts ?? 0), kwh: acc.kwh + (d.state.energyKwh ?? 0) }),
    { watts: 0, kwh: 0 },
  );

  return (
    <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <View>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Simulation and account</Text>
      </View>

      <Card accent={colors.primary}>
        <Row gap={space.md}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(profile?.user.name ?? 'SL')}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{profile?.user.name ?? 'Signed out'}</Text>
            <Text style={styles.email}>{profile?.user.email}</Text>
          </View>
        </Row>
        <Divider />
        <Row style={styles.metaRow}>
          <Metric label="Home" value={snapshot?.home.sqft ?? 0} unit="sq ft" color={colors.textDim} />
          <Metric label="Rooms" value={snapshot?.rooms.length ?? 0} color={colors.textDim} />
          <Metric label="Devices" value={Object.keys(devices).length} color={colors.textDim} />
        </Row>
      </Card>

      <SectionHeader title="Time travel" />
      <Card>
        <Row style={styles.header}>
          <View>
            <Text style={styles.cardTitle}>Simulation speed</Text>
            <Text style={styles.cardMeta}>
              {scale}× real time · clock reads {formatMinutes(snapshot?.localMinutes ?? 0)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Advance the simulation"
            style={styles.refreshBtn}
            onPress={() => void refreshSim()}
          >
            <Text style={styles.refreshGlyph}>⟳</Text>
          </Pressable>
        </Row>

        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {SCALES.map((option) => (
            <Pressable
              key={option}
              onPress={() => setTimeScale(option)}
              style={[styles.scaleChip, scale === option && styles.scaleChipActive]}
            >
              <Text style={[styles.scaleText, scale === option && styles.scaleTextActive]}>{option}×</Text>
            </Pressable>
          ))}
        </Row>

        <Text style={styles.note}>
          The whole simulation is driven by a scaled clock. At 60× one real second is one simulated minute, so sunrise, occupancy and
          appliance schedules all move quickly. Everything stays consistent: telemetry, energy totals and automations use the same
          clock.
        </Text>
      </Card>

      <SectionHeader title="Live totals" />
      <Card>
        <Row style={styles.metaRow}>
          <Metric label="Draw now" value={Math.round(totals.watts)} unit="W" color={colors.amber} />
          <Metric label="Lifetime" value={totals.kwh.toFixed(1)} unit="kWh" color={colors.primarySoft} />
          <Metric label="Events" value={events.length} color={colors.textDim} />
        </Row>
      </Card>

      <SectionHeader title="Connection" />
      <Card>
        <Row style={styles.header}>
          <Text style={styles.detailLabel}>Server</Text>
          <Pill label="connected" color={colors.green} filled />
        </Row>
        <Text style={styles.mono}>{BASE_URL}</Text>
        <Divider />
        <Text style={styles.note}>
          The app talks to a local Express + SQLite simulator over REST and a WebSocket feed. Set EXPO_PUBLIC_API_URL if you need to
          point a physical device at a different host.
        </Text>
      </Card>

      <Pressable
        style={[styles.logout, confirmLogout && styles.logoutConfirm]}
        onPress={() => {
          if (confirmLogout) void logout();
          else setConfirmLogout(true);
        }}
      >
        <Text style={styles.logoutText}>{confirmLogout ? 'Tap again to sign out' : 'Sign out'}</Text>
      </Pressable>

      <Text style={styles.version}>Smart Living · local simulation build</Text>
    </ScreenScroll>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint, marginTop: 2 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(91,141,239,0.2)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(91,141,239,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...type.section, color: colors.primarySoft },
  name: { ...type.section, color: colors.text },
  email: { ...type.tiny, color: colors.textFaint },
  metaRow: { justifyContent: 'space-between' },
  header: { justifyContent: 'space-between' },
  cardTitle: { ...type.section, color: colors.text },
  cardMeta: { ...type.tiny, color: colors.textFaint, marginTop: 2 },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  refreshGlyph: { color: colors.textDim, fontSize: 15 },
  scaleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  scaleChipActive: { backgroundColor: 'rgba(91,141,239,0.3)', borderColor: colors.primary },
  scaleText: { ...type.small, color: colors.textDim },
  scaleTextActive: { color: colors.text, fontWeight: '700' },
  note: { ...type.small, color: colors.textFaint, lineHeight: 18 },
  detailLabel: { ...type.small, color: colors.textDim },
  mono: { ...type.tiny, color: colors.primarySoft, fontFamily: 'monospace' },
  logout: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${colors.red}55`,
    paddingVertical: 15,
    alignItems: 'center',
  },
  logoutConfirm: { backgroundColor: 'rgba(255,92,122,0.18)', borderColor: colors.red },
  logoutText: { ...type.body, color: colors.red, fontWeight: '700' },
  version: { ...type.tiny, color: colors.textFaint, textAlign: 'center' },
});