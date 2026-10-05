import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useApp } from './src/api/store';
import { AuthScreen } from './src/screens/AuthScreen';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ConnectionBanner } from './src/components/ConnectionBanner';
import { colors, radius, space, type } from './src/theme';

function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;

  const tone =
    toast.tone === 'ok' ? colors.green : toast.tone === 'error' ? colors.red : colors.primary;

  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <View style={[styles.toast, { borderColor: `${tone}77` }]}>
        <View style={[styles.toastDot, { backgroundColor: tone }]} />
        <Text style={styles.toastText}>{toast.text}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const boot = useApp((s) => s.boot);
  const booted = useApp((s) => s.booted);
  const authed = useApp((s) => s.authed);

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <LinearGradient colors={['#0A1024', '#070A14', '#0B0F1E']} style={styles.root}>
          <StatusBar style="light" />

          {!booted ? (
            <View style={styles.splash}>
              <Text style={styles.splashGlyph}>⌂</Text>
              <Text style={styles.splashTitle}>Smart Living</Text>
              <ActivityIndicator color={colors.primarySoft} style={{ marginTop: space.lg }} />
            </View>
          ) : authed ? (
            <>
              <ErrorBoundary>
                <RootNavigator />
              </ErrorBoundary>
              <ConnectionBanner />
              <Toast />
            </>
          ) : (
            <AuthScreen />
          )}
        </LinearGradient>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  splashGlyph: { fontSize: 48, color: colors.primarySoft },
  splashTitle: { ...type.hero, color: colors.text },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(13,18,34,0.96)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
    maxWidth: '92%',
  },
  toastDot: { width: 7, height: 7, borderRadius: 4 },
  toastText: { ...type.small, color: colors.text, flexShrink: 1 },
});