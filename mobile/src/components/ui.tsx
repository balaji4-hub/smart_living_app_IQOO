import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient as SvgGradient, Polyline, Stop } from 'react-native-svg';
import { useRef } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space, type } from '../theme';

export function tap() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function GlassCard({
  children,
  style,
  intensity = 24,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  return (
    <View style={[styles.glassWrap, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassTint} />
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  accent,
  label,
  hint,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accent?: string;
  label?: string;
  hint?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const body = (
    <Animated.View
      style={[
        styles.card,
        accent ? { borderColor: `${accent}55` } : null,
        { transform: [{ scale }] },
        style,
      ]}
    >
      {accent ? <View style={[styles.cardAccent, { backgroundColor: accent }]} /> : null}
      {children}
    </Animated.View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 40, bounciness: 4 }).start()
      }
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start()}
      onPress={() => {
        tap();
        onPress();
      }}
    >
      {body}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Pill({
  label,
  color = colors.primary,
  filled = false,
  style,
}: {
  label: string;
  color?: string;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.pill, { borderColor: `${color}66`, backgroundColor: filled ? color : `${color}1A` }, style]}>
      <Text style={[styles.pillText, { color: filled ? colors.bg : color }]}>{label}</Text>
    </View>
  );
}

export function Bar({
  value,
  min = 0,
  max = 100,
  color = colors.primary,
  height = 6,
  track = colors.surfaceAlt,
}: {
  value: number;
  min?: number;
  max?: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const span = max - min;
  const pct = Math.max(0, Math.min(1, span === 0 ? 0 : (value - min) / span));
  return (
    <View style={[styles.barTrack, { height, borderRadius: height, backgroundColor: track }]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function Metric({
  label,
  value,
  unit,
  color = colors.text,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  icon?: string;
}) {
  return (
    <View style={styles.metric}>
      {icon ? <Text style={styles.metricIcon}>{icon}</Text> : null}
      <Text style={[styles.metricValue, { color }]}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

/** Sparkline that stretches to the container width. */
export function Sparkline({
  samples,
  color = colors.primary,
  height = 48,
  showArea = true,
}: {
  samples: number[];
  color?: string;
  height?: number;
  showArea?: boolean;
}) {
  if (samples.length < 2) return <View style={{ height }} />;

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1;
  const step = 100 / (samples.length - 1);
  const points = samples
    .map((s, i) => `${(i * step).toFixed(2)},${(100 - ((s - min) / span) * 100).toFixed(2)}`)
    .join(' ');
  const area = `0,100 ${points} 100,100`;

  return (
    <Svg width="100%" height={height} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <SvgGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.4} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </SvgGradient>
      </Defs>
      {showArea ? <Polyline points={area} fill="url(#sparkFill)" stroke="none" /> : null}
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function ScreenScroll({
  children,
  style,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      style={[{ flex: 1 }, style]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primarySoft}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Row({ children, gap = space.md, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  glassWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  glassTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(18,26,46,0.5)',
  },
  card: {
    backgroundColor: 'rgba(18,26,46,0.72)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    padding: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...type.section, color: colors.text },
  sectionAction: { ...type.small, color: colors.primarySoft },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  pillText: { ...type.tiny },
  barTrack: { width: '100%', overflow: 'hidden' },
  metric: { gap: 2, minWidth: 62 },
  metricIcon: { fontSize: 14 },
  metricValue: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  metricUnit: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  metricLabel: { ...type.tiny, color: colors.textFaint, textTransform: 'uppercase' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 40 },
  emptyIcon: { fontSize: 34 },
  emptyTitle: { ...type.section, color: colors.text },
  emptyBody: { ...type.small, color: colors.textFaint, textAlign: 'center', paddingHorizontal: space.xl },
  scrollContent: { padding: space.lg, paddingBottom: 150, gap: space.lg },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
    overflow: 'hidden',
  },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { ...type.hero, color: colors.text },
  heroSubtitle: { ...type.small, color: colors.textDim },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSoft },
  kbd: { ...type.tiny, color: colors.textFaint },
});