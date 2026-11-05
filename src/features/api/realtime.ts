import { RealtimeClient } from '@supabase/realtime-js';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
 * If realtime isn't configured (or the socket is down), useSlots polls every 5 s instead.
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

/** Re-fetch a day's slots past the server cache, straight into the query cache. */
function refreshDay(qc: QueryClient, venueId: string, day: string) {
  const key = qk.slots(venueId, day as DayKey);
  if (!qc.getQueryState(key)) return; // nobody is looking at that day
  qc.fetchQuery({ queryKey: key, queryFn: ({ signal }) => api.getSlots(venueId, day as DayKey, signal, true), staleTime: 0 }).catch(() => {});
}

/**
 * Live slots for one turf. Returns whether the realtime channel is connected,
 * so the caller can poll fast only when it isn't.
 */
export function useLiveSlots(venueId: string, day: DayKey) {
  const qc = useQueryClient();
  const rt = useAppConfig().data?.realtime;
  const [live, setLive] = useState(false);
  const dayRef = useRef(day);
  useEffect(() => {
    dayRef.current = day;
  }, [day]);

  useEffect(() => {
    if (!rt || !venueId) return;
    const channel = getClient(rt)
      .channel(`slots:${venueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: rt.table, filter: `venue_id=eq.${venueId}` }, (payload) => {
        const changedDay = (payload.new as { day?: string } | null)?.day ?? (payload.old as { day?: string } | null)?.day;
        if (changedDay) refreshDay(qc, venueId, changedDay);
        else qc.invalidateQueries({ queryKey: ['slots', venueId] });
      })
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        setLive(ok);
        // After (re)connecting we may have missed events: catch up once.
        if (ok) refreshDay(qc, venueId, dayRef.current);
      });
    return () => {
      setLive(false);
      channel.unsubscribe();
    };
  }, [rt, venueId, qc]);

  useForegroundReconnect(!!rt);
  return live;
}

/**
 * Explore's "Available today": refresh the list (debounced) whenever any turf's
 * slots change today, so a just-filled turf doesn't keep saying it's free.
 */
export function useLiveExplore(today: DayKey) {
  const qc = useQueryClient();
  const rt = useAppConfig().data?.realtime;
  useEffect(() => {
    if (!rt) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const channel = getClient(rt)
      .channel(`explore:${today}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: rt.table, filter: `day=eq.${today}` }, () => {
        if (t) return;
        t = setTimeout(() => {
          t = null;
          qc.invalidateQueries({ queryKey: ['explore'] });
        }, 1500);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      channel.unsubscribe();
    };
  }, [rt, today, qc]);
  useForegroundReconnect(!!rt);
}

/** Sockets die in the background; reconnect when the app returns to the foreground. */
function useForegroundReconnect(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && client && !client.isConnected()) client.connect();
    });
    return () => sub.remove();
  }, [enabled]);
}
