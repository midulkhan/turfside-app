import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { PERSISTED_ROOTS } from '@/features/api/queries';
import { ApiError } from '@/features/api/types';
import { initNetwork } from '@/lib/network';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 24 * 60 * 60_000,
      retry: (count, error) => !(error instanceof ApiError && error.code !== 'network') && count < 2,
      retryDelay: (n) => Math.min(800 * 2 ** n, 5000),
      refetchOnReconnect: true,
    },
    // Never auto-retry money movement (idempotency keys handle manual retries), and never sit
    // silently paused while offline: actions fail at once with a clear "no connection" error.
    mutations: { retry: 0, networkMode: 'always' },
  },
});

/** Persist only slow-changing data (venue info, bookings) so the app opens instantly offline. */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'ts.query.v1', throttleTime: 1500 });
export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60_000,
  buster: 'v2', // v2: live API (drops cached demo data)
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) =>
      q.state.status === 'success' && PERSISTED_ROOTS.has(String(q.queryKey[0])),
  },
};

// Refetch when the app comes back to the foreground (React Native has no window focus).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
}
// Real connectivity (pauses queries offline, refetches on reconnect).
initNetwork();
