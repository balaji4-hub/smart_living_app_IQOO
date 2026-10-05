import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currencySymbol, useApp } from '../api/store';
import { colors, radius, space, type } from '../theme';
import { Bar, Card, EmptyState, Metric, Pill, Row, ScreenScroll, SectionHeader } from '../components/ui';

export function EnergyScreen() {
  const insets = useSafeAreaInsets();
  const refreshAll = useApp((s) => s.refreshEnergy);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const energy = useApp((s) => s.energy);
  const insights = useApp((s) => s.insights);
  const liveWatts = useApp((s) => s.liveWatts);
  const liveByCategory = useApp((s) => s.liveByCategory);
  const refreshEnergy = useApp((s) => s.refreshEnergy);
  const currency = useApp((s) => s.profile?.user.currency ?? 'USD');
  const symbol = currencySymbol(currency);

  useEffect(() => {
    const id = setInterval(() => void refreshEnergy(), 30000);
    return () => clearInterval(id);
  }, [refreshEnergy]);

  const hourly = energy?.hourly ?? [];
  const maxWatts = useMemo(() => Math.max(1, ...hourly.map((h) => h.avgWatts)), [hourly]);
  const totalToday = energy?.today.kwh ?? 0;

  if (!energy) {
    return (
      <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
        <EmptyState icon="⚡" title="Gathering energy data" body="The simulator is still backfilling history." />
      </ScreenScroll>
    );
  }

  const trend = energy.weekOverWeekPct;
  const costPct = energy.today.vsYesterdayPct;

  return (
    <ScreenScroll style={{ paddingTop: insets.top }}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <View>
        <Text style={styles.title}>Energy</Text>
        <Text style={styles.subtitle}>Today · {totalToday.toFixed(2)} kWh at {symbol}{energy.ratePerKwh.toFixed(2)}/kWh</Text>
      </View>

      <Card accent={colors.amber}>
        <Text style={styles.bigLabel}>Estimated cost today</Text>
        <Text style={styles.bigValue}>
          {symbol}
          {energy.today.cost.toFixed(2)}
        </Text>
        <Row gap={space.md} style={{ marginTop: space.xs }}>
          <Pill
            label={`${costPct >= 0 ? '↑' : '↓'} ${Math.abs(costPct).toFixed(0)}% vs yesterday`}
            color={costPct > 0 ? colors.red : colors.green}
          />
          <Pill label={`${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend).toFixed(0)}% week over week`} color={trend > 0 ? colors.red : colors.green} />
        </Row>
      </Card>

      <Row gap={space.md}>
        <Card style={styles.flex}>
          <Metric label="Live draw" value={Math.round(liveWatts)} unit="W" color={colors.amber} />
        </Card>
        <Card style={styles.flex}>
          <Metric label="Peak today" value={Math.round(energy.today.peakWatts)} unit="W" color={colors.orange} />
        </Card>
        <Card style={styles.flex}>
          <Metric label="Avg draw" value={Math.round(energy.today.avgWatts)} unit="W" color={colors.primarySoft} />
        </Card>
      </Row>

      <Card>
        <Row style={styles.header}>
          <Text style={styles.cardTitle}>Hourly consumption</Text>
          <Text style={styles.cardMeta}>{hourly.length} h</Text>
        </Row>
        <View style={styles.chart}>
          {hourly.map((bucket, index) => {
            const isNow = index === hourly.length - 1;
            const height = Math.max(3, (bucket.avgWatts / maxWatts) * 100);
            return (
              <View key={bucket.startMinute} style={styles.barColumn}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: `${height}%`,
                        backgroundColor: isNow ? colors.amber : `${colors.primary}99`,
                      },
                    ]}
                  />
                </View>
                {index % 3 === 0 ? <Text style={styles.barLabel}>{bucket.label}</Text> : <View style={styles.barLabelSpacer} />}
              </View>
            );
          })}
        </View>
        <Row gap={space.md} style={{ marginTop: space.sm }}>
          <Metric label="Yesterday" value={energy.yesterday.kwh.toFixed(2)} unit="kWh" color={colors.textDim} />
          <Metric label="Month" value={energy.month.kwh.toFixed(1)} unit="kWh" color={colors.textDim} />
          <Metric label="Projected" value={energy.month.projectedKwh.toFixed(0)} unit="kWh" color={colors.primarySoft} />
        </Row>
      </Card>

      <SectionHeader title="By category" />
      <Card>
        {energy.byCategory.map((entry) => (
          <View key={entry.category} style={styles.breakdownRow}>
            <Row style={styles.breakdownHeader}>
              <Text style={styles.breakdownLabel}>{entry.category}</Text>
              <Text style={styles.breakdownValue}>
                {entry.kwh.toFixed(2)} kWh · {symbol}
                {entry.cost.toFixed(2)}
              </Text>
            </Row>
            <Bar value={entry.pct} color={colors.primary} height={5} />
          </View>
        ))}
      </Card>

      <SectionHeader title="By room" />
      <Card>
        {energy.byRoom.map((entry) => (
          <View key={entry.room} style={styles.breakdownRow}>
            <Row style={styles.breakdownHeader}>
              <Text style={styles.breakdownLabel}>{entry.room}</Text>
              <Text style={styles.breakdownValue}>{Math.round(entry.pct)}%</Text>
            </Row>
            <Bar value={entry.pct} color={colors.cyan} height={5} />
          </View>
        ))}
      </Card>

      {energy.topConsumers.length ? (
        <>
          <SectionHeader title="Top consumers" />
          <Card>
            {energy.topConsumers.map((device, index) => {
              const share = totalToday === 0 ? 0 : (device.kwh / totalToday) * 100;
              return (
                <View key={device.id} style={styles.breakdownRow}>
                  <Row style={styles.breakdownHeader}>
                    <Text style={styles.breakdownLabel}>
                      {index + 1}. {device.name}
                    </Text>
                    <Text style={styles.breakdownValue}>
                      {device.kwh.toFixed(2)} kWh · {share.toFixed(0)}%
                    </Text>
                  </Row>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Live by category" />
      <Card>
        {Object.entries(liveByCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([category, watts]) => (
            <View key={category} style={styles.breakdownRow}>
              <Row style={styles.breakdownHeader}>
                <Text style={styles.breakdownLabel}>{category}</Text>
                <Text style={styles.breakdownValue}>{Math.round(watts)} W</Text>
              </Row>
            </View>
          ))}
      </Card>

      <SectionHeader title="Insights" />
      {insights.length === 0 ? (
        <Card>
          <Text style={styles.muted}>No anomalies detected. Everything is running normally.</Text>
        </Card>
      ) : (
        insights.map((insight) => (
          <Card key={insight.id} accent={insight.severity === 'critical' ? colors.red : insight.severity === 'warning' ? colors.amber : colors.primary}>
            <Row gap={space.sm}>
              <Text style={styles.insightIcon}>
                {insight.severity === 'critical' ? '🚨' : insight.severity === 'warning' ? '⚠️' : insight.severity === 'success' ? '✅' : '💡'}
              </Text>
              <View style={styles.flex}>
                <Text style={styles.insightTitle}>{insight.title}</Text>
                <Text style={styles.insightBody}>{insight.body}</Text>
              </View>
            </Row>
            {insight.savingsKwh ? <Pill label={`~${insight.savingsKwh.toFixed(2)} kWh/day recoverable`} color={colors.green} /> : null}
          </Card>
        ))
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint, marginTop: 2 },
  bigLabel: { ...type.tiny, color: colors.textFaint, textTransform: 'uppercase' },
  bigValue: { fontSize: 38, fontWeight: '700', color: colors.text, letterSpacing: -1.2 },
  header: { justifyContent: 'space-between' },
  cardTitle: { ...type.section, color: colors.text },
  cardMeta: { ...type.tiny, color: colors.textFaint },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 2 },
  barColumn: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { width: '100%', height: 108, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
  barLabel: { ...type.tiny, fontSize: 8, color: colors.textFaint },
  barLabelSpacer: { height: 11 },
  breakdownRow: { gap: 5 },
  breakdownHeader: { justifyContent: 'space-between' },
  breakdownLabel: { ...type.small, color: colors.textDim, textTransform: 'capitalize' },
  breakdownValue: { ...type.tiny, color: colors.textFaint },
  muted: { ...type.small, color: colors.textFaint },
  insightIcon: { fontSize: 17 },
  insightTitle: { ...type.body, color: colors.text, fontWeight: '700' },
  insightBody: { ...type.small, color: colors.textDim, marginTop: 3, lineHeight: 18 },
});