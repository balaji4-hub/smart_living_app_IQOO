import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BASE_URL } from '../api/client';
import { useApp } from '../api/store';
import { colors, radius, space, type } from '../theme';

/**
 * Surfaces a dropped realtime connection. Without this the app silently shows
 * stale numbers and the user assumes the house is just idle.
 */
export function ConnectionBanner() {
  const connected = useApp((s) => s.connected);
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: connected ? 0 : 1,
      duration: connected ? 220 : 320,
      useNativeDriver: true,
    }).start();
  }, [connected, anim]);

  if (connected) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          top: insets.top + 6,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }),
            },
          ],
        },
      ]}
    >
      <View style={styles.banner}>
        <View style={styles.dot} />
        <Text style={styles.text}>Reconnecting to the simulator…</Text>
      </View>
      <Text style={styles.host} numberOfLines={1}>
        {BASE_URL.replace(/^https?:\/\//, '')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center', gap: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(30,20,14,0.96)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${colors.amber}66`,
    paddingHorizontal: space.lg,
    paddingVertical: 9,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.amber },
  text: { ...type.small, color: colors.text },
  host: { ...type.tiny, color: colors.textFaint },
});