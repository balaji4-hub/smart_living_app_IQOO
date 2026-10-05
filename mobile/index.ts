import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import App from './App';
import { reportClientError } from './src/api/report';

// Surface the real cause in the Metro log instead of only a red box on a
// device we cannot attach a console to, and mirror it to the API log.
LogBox.ignoreLogs(['Require cycle']);

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const nativeConsoleError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  nativeConsoleError(...args);
  reportClientError('error', args.map(describe).join(' '));
};

console.warn = (...args: unknown[]) => {
  reportClientError('warn', args.map(describe).join(' '));
};

// Catch unhandled exceptions. Every access here is defensive: if ErrorUtils is
// missing in this engine we must still reach registerRootComponent below, or the
// app never mounts at all.
try {
  const scope = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => unknown;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const utils = scope.ErrorUtils;

  if (utils && typeof utils.setGlobalHandler === 'function') {
    const previous = typeof utils.getGlobalHandler === 'function' ? utils.getGlobalHandler() : undefined;
    utils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      reportClientError(isFatal ? 'FATAL' : 'error', describe(error));
      if (typeof previous === 'function') previous(error, isFatal);
    });
  }
} catch {
  /* error reporting must never block app startup */
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// If the app somehow never mounts, say so instead of showing a blank screen.
setTimeout(() => {
  reportClientError('warn', 'boot watchdog: 12s elapsed, reporting mount state');
}, 12000);