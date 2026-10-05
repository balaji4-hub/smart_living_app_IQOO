import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BASE_URL, api } from '../api/client';
import { useApp } from '../api/store';
import { colors, radius, space, type } from '../theme';
import { Pill, Row } from '../components/ui';

export function AuthScreen() {
  const login = useApp((s) => s.login);
  const register = useApp((s) => s.register);
  const authError = useApp((s) => s.authError);
  const busy = useApp((s) => s.busy);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [reach, setReach] = useState<'checking' | 'up' | 'down'>('checking');
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .demoCredentials()
      .then((res) => {
        if (cancelled) return;
        setCredentials(res);
        setEmail(res.email);
        setPassword(res.password);
        setReach('up');
      })
      .catch(() => {
        if (!cancelled) setReach('down');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    setLocalError(null);
    if (!email.includes('@')) return setLocalError('Enter a valid email address');
    if (password.length < 8) return setLocalError('Password needs at least 8 characters');
    if (mode === 'register' && name.trim().length < 2) return setLocalError('Tell us your name');

    const ok = mode === 'login' ? await login(email.trim(), password) : await register(email.trim(), password, name.trim());
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    return undefined;
  };

  const error = localError ?? authError;

  return (
    <LinearGradient colors={['#0A1024', '#070A14', '#0B0F1E']} style={styles.root}>
      <View style={styles.glow} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandBlock}>
            <View style={styles.logo}>
              <Text style={styles.logoGlyph}>⌂</Text>
            </View>
            <Text style={styles.title}>Smart Living</Text>
            <Text style={styles.tagline}>A whole home, simulated beautifully.</Text>
          </View>

          <View style={styles.statusRow}>
            <Pill
              label={reach === 'up' ? `Server online · ${BASE_URL.replace(/^https?:\/\//, '')}` : reach === 'down' ? 'Server offline' : 'Contacting server…'}
              color={reach === 'up' ? colors.green : reach === 'down' ? colors.red : colors.textFaint}
              filled={reach === 'up'}
            />
          </View>

          <View style={styles.form}>
            <View style={styles.segment}>
              {(['login', 'register'] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    setMode(value);
                    setLocalError(null);
                  }}
                  style={[styles.segmentItem, mode === value ? styles.segmentItemActive : null]}
                >
                  <Text style={[styles.segmentText, mode === value ? styles.segmentTextActive : null]}>
                    {value === 'login' ? 'Sign in' : 'Create account'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'register' ? (
              <Field label="Name" value={name} onChangeText={setName} placeholder="Alex Rivera" autoCapitalize="words" />
            ) : null}

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: busy || reach === 'down' }}
              onPress={submit}
              disabled={busy || reach === 'down'}
              style={({ pressed }) => [
                styles.submit,
                (busy || reach === 'down') && styles.submitDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.submitText}>{mode === 'login' ? 'Enter my home' : 'Create my home'}</Text>
              )}
            </Pressable>

            {credentials && mode === 'login' ? (
              <Row gap={8} style={styles.demoRow}>
                <Text style={styles.demoText}>
                  Demo home prefilled · {credentials.name}
                </Text>
              </Row>
            ) : null}
          </View>

          <Text style={styles.footnote}>
            No hardware required. Every device, sensor and automation runs on a local simulator with realistic physics.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, focused && styles.inputFocused]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -140,
    left: -80,
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: 'rgba(91,141,239,0.22)',
    filter: [{ blur: 60 }],
  },
  content: { padding: space.xl, paddingTop: 72, paddingBottom: 48, gap: space.xl },
  brandBlock: { gap: space.sm },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: 'rgba(91,141,239,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(91,141,239,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  logoGlyph: { fontSize: 30, color: colors.primarySoft },
  title: { ...type.hero, fontSize: 40, color: colors.text },
  tagline: { ...type.body, color: colors.textDim },
  statusRow: { flexDirection: 'row' },
  form: { gap: space.md },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
    marginBottom: space.xs,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.surfaceAlt },
  segmentText: { ...type.small, color: colors.textFaint },
  segmentTextActive: { color: colors.text, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabel: { ...type.tiny, color: colors.textFaint, textTransform: 'uppercase' },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    color: colors.text,
    ...type.body,
  },
  inputFocused: { borderColor: colors.primary },
  error: { ...type.small, color: colors.red },
  submit: {
    marginTop: space.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { ...type.section, color: colors.bg },
  demoRow: { justifyContent: 'center' },
  demoText: { ...type.tiny, color: colors.textFaint },
  footnote: { ...type.tiny, color: colors.textFaint, textAlign: 'center', lineHeight: 16 },
});