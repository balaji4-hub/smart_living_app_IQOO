import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single bad frame shows a recoverable screen
 * instead of a permanent white screen. Reloading remounts the whole tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SmartLiving] render crash', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.glyph}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body} numberOfLines={6}>
          {error.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload the app"
          onPress={this.reset}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Reload</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
    backgroundColor: colors.bg,
  },
  glyph: { fontSize: 40 },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: { ...type.small, color: colors.textFaint, textAlign: 'center' },
  button: {
    marginTop: space.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 34,
  },
  buttonText: { ...type.section, color: colors.bg },
});