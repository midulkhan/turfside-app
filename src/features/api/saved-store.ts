import { useSyncExternalStore } from 'react';

/**
 * Same-frame favourite state. Tapping a heart writes here synchronously, so the
 * icon flips on the very next frame — before any network or cache work. The
 * override is dropped once the server confirms (or rolled back on error).
 */
const overrides = new Map<string, boolean>();
const inflight = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function beginSaved(id: string, value: boolean) {
  overrides.set(id, value);
  inflight.set(id, (inflight.get(id) ?? 0) + 1);
  emit();
}

/** Call when a request finishes. Only clears once the last overlapping tap has settled. */
export function endSaved(id: string, failed: boolean) {
  const left = (inflight.get(id) ?? 1) - 1;
  if (left <= 0 || failed) {
    inflight.delete(id);
    overrides.delete(id);
    emit();
  } else inflight.set(id, left);
}

export function useIsSaved(id: string, server: boolean) {
  const o = useSyncExternalStore(
    subscribe,
    () => overrides.get(id),
    () => undefined,
  );
  return o ?? server;
}
