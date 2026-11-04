import { RealtimeClient } from '@supabase/realtime-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { DayKey } from '@/lib/time';

import * as api from './client';
import { qk } from './queries';
import type { AppConfig } from './types';

/**
 * Live slot availability.
 *
 * The server keeps a tiny `slot_updates(venue_id, day, updated_at)` row that is
 * touched whenever a booking on that day changes. We listen to it through
 * Supabase Realtime (the public anon key can read only that table: no personal
 * data) and refetch the day's slots from our API the moment something changes.
 * If realtime isn't configured, the 30 s polling in useSlots still applies.
 */
let client: RealtimeClient | null = null;
function getClient(cfg: NonNullable<AppConfig['realtime']>) {
  client ??= new RealtimeClient(`${cfg.url.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1`, {
    params: { apikey: cfg.anonKey },
    heartbeatIntervalMs: 25_000,
  });
  return client;
}

export function useAppConfig() {
  return useQuery({ queryKey: ['config'], queryFn: ({ signal }) => api.getConfig(signal), staleTime: 10 * 60_000 });
}

export function useLiveSlots(venueId: string, day: DayKey) {
  const qc = useQueryClient();
  const rt = useAppConfig().data?.realtime;

  useEffect(() => {
    if (!rt || !venueId) return;
    const channel = getClient(rt)
      .channel(`slots:${venueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: rt.table, filter: `venue_id=eq.${venueId}` }, (payload) => {
        const changedDay = (payload.new as { day?: string } | null)?.day ?? (payload.old as { day?: string } | null)?.day;
        qc.invalidateQueries({ queryKey: changedDay ? qk.slots(venueId, changedDay) : ['slots', venueId] });
      })
      .subscribe((status) => {
        // After a reconnect we may have missed events: catch up once.
        if (status === 'SUBSCRIBED') qc.invalidateQueries({ queryKey: qk.slots(venueId, day) });
      });
    return () => {
      channel.unsubscribe();
    };
    // `day` only seeds the catch-up refetch; changing it must not resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, venueId, qc]);

  // Sockets die in the background; reconnect when the app returns to the foreground.
  useEffect(() => {
    if (!rt) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && client && !client.isConnected()) client.connect();
    });
    return () => sub.remove();
  }, [rt]);
}
