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

/**
 * A fresh topic per subscription. The realtime client hands back an existing channel for a
 * topic it already has, and a channel that is already subscribed can't take new listeners,
 * so two screens (or a quick remount) watching the same match would crash.
 */
let seq = 0;
const topic = (name: string) => `${name}:${++seq}`;

export function useAppConfig() {
  // v2: skips settings persisted before realtime was configured on the server.
  return useQuery({ queryKey: ['config', 2], queryFn: ({ signal }) => api.getConfig(signal), staleTime: 2 * 60_000 });
}

/**
 * A realtime event said this day changed in transaction `xid`: re-fetch it, asking the server
 * for an answer that includes that change (served from its cache when it already does).
 */
function refreshDay(qc: QueryClient, venueId: string, day: string, xid?: string) {
  const key = qk.slots(venueId, day as DayKey);
  if (!qc.getQueryState(key)) return; // nobody is looking at that day
  const after = xid && /^\d{1,20}$/.test(xid) ? xid : true;
  qc.fetchQuery({ queryKey: key, queryFn: ({ signal }) => api.getSlots(venueId, day as DayKey, signal, after), staleTime: 0 }).catch(
    () => {},
  );
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
      .channel(topic(`slots:${venueId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: rt.table, filter: `venue_id=eq.${venueId}` }, (payload) => {
        const row = (payload.new ?? null) as { day?: string; xid?: string | number } | null;
        const changedDay = row?.day ?? (payload.old as { day?: string } | null)?.day;
        if (changedDay) refreshDay(qc, venueId, changedDay, row?.xid != null ? String(row.xid) : undefined);
        else qc.invalidateQueries({ queryKey: ['slots', venueId] });
      })
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        setLive(ok);
        // After (re)connecting we may have missed events: catch up once. The server keeps its
        // cache current on every booking change, so a normal (cached) refetch is enough.
        // A load already under way is reused rather than repeated.
        if (ok) qc.invalidateQueries({ queryKey: qk.slots(venueId, dayRef.current), exact: true }, { cancelRefetch: false });
      });
    return () => {
      setLive(false);
      void getClient(rt).removeChannel(channel);
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
      .channel(topic(`explore:${today}`))
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
      void getClient(rt).removeChannel(channel);
    };
  }, [rt, today, qc]);
  useForegroundReconnect(!!rt);
}

// ── Find players ─────────────────────────────────────────────────────────

/**
 * Live match: the server touches `match_updates(match_id)` whenever the match or anyone's
 * request on it changes (asked, accepted, declined, paid, withdrawn, released). We refetch
 * this match (and the organiser's view of it) the moment that happens. Without realtime,
 * poll every 5 s instead. Returns whether the socket is live.
 */
export function useLiveMatch(id: string | undefined) {
  const qc = useQueryClient();
  const rt = useAppConfig().data?.realtime;
  const table = rt?.matchTable;
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!rt || !table || !id) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: qk.match(id) });
      void qc.invalidateQueries({ queryKey: qk.matchManage(id) });
    };
    const channel = getClient(rt)
      .channel(topic(`match:${id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `match_id=eq.${id}` }, () => {
        refresh();
        void qc.invalidateQueries({ queryKey: ['matches'] });
      })
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        setLive(ok);
        if (ok) refresh(); // catch up on anything missed while connecting
      });
    return () => {
      setLive(false);
      void getClient(rt).removeChannel(channel);
    };
  }, [rt, table, id, qc]);

  usePollWhileDown(!live && !!id, 5_000, () => {
    void qc.invalidateQueries({ queryKey: qk.match(id!) });
    void qc.invalidateQueries({ queryKey: qk.matchManage(id!) });
  });
  useForegroundReconnect(!!rt);
  return live;
}

/** Live feed: any match changing refreshes the list (debounced). Polls every 15 s without realtime. */
export function useLiveMatchFeed() {
  const qc = useQueryClient();
  const rt = useAppConfig().data?.realtime;
  const table = rt?.matchTable;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!rt || !table) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const channel = getClient(rt)
      .channel(topic(`matches:feed`))
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (t) return;
        t = setTimeout(() => {
          t = null;
          void qc.invalidateQueries({ queryKey: ['matches'] });
        }, 600);
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      if (t) clearTimeout(t);
      setLive(false);
      void getClient(rt).removeChannel(channel);
    };
  }, [rt, table, qc]);
  usePollWhileDown(!live, 15_000, () => void qc.invalidateQueries({ queryKey: ['matches'] }));
  useForegroundReconnect(!!rt);
  return live;
}

/**
 * Refetch at a known moment, e.g. when a held spot's 5-minute pay window ends: nothing is
 * written to the database at that instant, so there is no realtime event to wait for.
 */
export function useRefreshAt(at: number | null | undefined, refresh: () => void) {
  const cb = useRef(refresh);
  useEffect(() => {
    cb.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!at) return;
    const ms = at - Date.now() + 800;
    if (ms > 24 * 3600_000) return;
    const t = setTimeout(() => cb.current(), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [at]);
}

function usePollWhileDown(enabled: boolean, every: number, tick: () => void) {
  const cb = useRef(tick);
  useEffect(() => {
    cb.current = tick;
  }, [tick]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (AppState.currentState === 'active') cb.current();
    }, every);
    return () => clearInterval(t);
  }, [enabled, every]);
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
