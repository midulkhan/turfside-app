import { useCallback, useState } from 'react';

/**
 * Spinner state only for user-initiated pulls. Binding RefreshControl to a
 * query's isRefetching made iOS scroll the page down whenever data refreshed
 * in the background (e.g. after changing the area) — that was the "jump".
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, onRefresh };
}
