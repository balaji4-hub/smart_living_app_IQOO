import { BASE_URL } from './client';

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ships a client-side error to the API so a crash on a physical device shows up
 * in the server log. We cannot attach a debugger to a phone, and Expo Go's red
 * box is not readable from the terminal, so this is the only feedback channel.
 *
 * Best effort by design: never throws, never blocks, never recurses.
 */
export function reportClientError(level: string, message: string): void {
  try {
    const trimmed = String(message ?? '').slice(0, 4000);
    if (!trimmed) return;
    queue.push(JSON.stringify({ level, message: trimmed, at: new Date().toISOString() }));
    if (queue.length > 20) queue = queue.slice(-20);
    if (timer) return;
    timer = setTimeout(flush, 400);
  } catch {
    /* reporting must never break the app */
  }
}

function flush(): void {
  timer = null;
  const batch = queue;
  queue = [];
  try {
    const body = JSON.stringify(batch.length === 1 ? JSON.parse(batch[0]) : { batch });
    void fetch(`${BASE_URL}/api/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* server unreachable; the Metro log still has the console output */
    });
  } catch {
    /* ignore */
  }
}