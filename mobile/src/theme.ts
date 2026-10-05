/**
 * Design tokens. One dark, high-contrast palette shared by the 3D scene and
 * the React Native UI so the app reads as a single surface.
 */

export const colors = {
  bg: '#070A14',
  bgElevated: '#0D1222',
  surface: '#121A2E',
  surfaceAlt: '#18223C',
  border: '#222E4A',
  borderSoft: '#1A2338',

  text: '#F2F5FF',
  textDim: '#A9B4CE',
  textFaint: '#6B7896',

  primary: '#5B8DEF',
  primarySoft: '#8AB4FF',
  accent: '#7C5CFF',
  cyan: '#48C2E0',
  teal: '#2FB89C',
  green: '#3DDC97',
  amber: '#F2A03D',
  orange: '#FF8A5B',
  red: '#FF5C7A',
  pink: '#FF6BC1',

  on: '#FFC96B',
  off: '#4A5878',
  alert: '#FF5C7A',
  ok: '#3DDC97',
} as const;

export const kindColor: Record<string, string> = {
  light: colors.amber,
  thermostat: colors.orange,
  thermostat_valve: colors.orange,
  fan: colors.cyan,
  blinds: colors.primarySoft,
  plug: colors.teal,
  tv: colors.accent,
  speaker: colors.pink,
  camera: colors.primary,
  doorbell: colors.primary,
  lock: colors.green,
  sensor_motion: colors.cyan,
  sensor_leak: colors.cyan,
  sensor_contact: colors.cyan,
  air_quality: colors.teal,
  vacuum: colors.accent,
  garage: colors.green,
};

export const severityColor: Record<string, string> = {
  critical: colors.red,
  warning: colors.amber,
  info: colors.primary,
  success: colors.green,
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 18, xl: 26, xxl: 36 };

export const type = {
  hero: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  section: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
};

/** Two-stop gradients used across cards and headers. */
export const gradients = {
  bg: ['#070A14', '#0C1224', '#070A14'] as const,
  primary: ['#5B8DEF', '#7C5CFF'] as const,
  warm: ['#FFB347', '#FF6B6B'] as const,
  cool: ['#48C2E0', '#5B8DEF'] as const,
  mint: ['#3DDC97', '#2FB89C'] as const,
  surface: ['rgba(255,255,255,0.09)', 'rgba(255,255,255,0.02)'] as const,
};