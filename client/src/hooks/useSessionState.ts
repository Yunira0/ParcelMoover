import { useCallback, useState } from 'react';
import { getCurrentUser } from '../utils/auth';

/**
 * useState that survives leaving the page: the value is kept in sessionStorage,
 * so a list filter is still applied when you come back to the list - by the
 * Back button, the sidebar, or a refresh - until it is cleared by hand. It goes
 * away with the browser tab.
 *
 * Keys are namespaced by user id, so a different login in the same tab never
 * inherits the last person's filters (a rider id picked by one admin means
 * nothing - or too much - to the next).
 *
 * The value is read in the initial state, not an effect, so a page's first
 * fetch already carries the restored filter instead of loading unfiltered and
 * then again.
 */
const storageKey = (key: string) => `filters:${getCurrentUser()?.id ?? 'anon'}:${key}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Private mode / blocked storage / a corrupt entry: just start unfiltered.
    return fallback;
  }
}

export function useSessionState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [entry, setEntry] = useState(() => ({ key, value: read(key, initial) }));

  // The same component instance can be reused for another list (Rider COD and
  // Vendor COD are one component with a different prop), so a new key loads
  // that key's own value during render rather than keeping the old one.
  let current = entry;
  if (entry.key !== key) {
    current = { key, value: read(key, initial) };
    setEntry(current);
  }

  const setValue = useCallback(
    (next: T) => {
      setEntry({ key, value: next });
      try {
        sessionStorage.setItem(storageKey(key), JSON.stringify(next));
      } catch {
        // Storage unavailable: the filter still works, it just won't be remembered.
      }
    },
    [key],
  );

  return [current.value, setValue];
}
