import { useCallback, useEffect, useState } from 'react';

export const LIVE_CHECK_DELAY_MS = 350;

export type LiveCheck<T> =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: T }
  | { status: 'error' };

interface Entry<T> {
  value: string;
  nonce: number;
  result: T | null;
  failed: boolean;
}

/**
 * Debounced server check of a field value (subdomain availability, NEAR account existence).
 * An empty `value` means "do not check" (idle). While a newer value waits for its answer the state
 * is `checking`, so a stale answer can never mark the current value as valid. In-flight requests
 * are aborted when the value changes.
 */
export function useLiveCheck<T>(
  value: string,
  check: (value: string, signal: AbortSignal) => Promise<T>,
  delay = LIVE_CHECK_DELAY_MS,
): { state: LiveCheck<T>; retry: () => void } {
  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      check(value, controller.signal).then(
        (result) => setEntry({ value, nonce, result, failed: false }),
        () => {
          if (!controller.signal.aborted) setEntry({ value, nonce, result: null, failed: true });
        },
      );
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, nonce, check, delay]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  let state: LiveCheck<T>;
  if (!value) state = { status: 'idle' };
  else if (entry?.value !== value || entry.nonce !== nonce) state = { status: 'checking' };
  else if (entry.failed || entry.result === null) state = { status: 'error' };
  else state = { status: 'done', result: entry.result };
  return { state, retry };
}
