import { keepPreviousData, type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useMemo } from 'react';

import type { DayKey } from '@/lib/time';

import * as api from './client';
import { beginSaved, endSaved } from './saved-store';
import type { Booking, BookingFilter, BookingPage, ExploreParams, ExploreResult, Match, MatchFeedParams, MatchLevel, MatchManage, MatchPosition, Page, SavedPlace, SavedPlaceInput, VenueDetail, VenueSummary } from './types';

/**
 * Query keys + cache policy in one place.
 * - Venue info changes rarely → long staleTime, persisted to disk for instant start.
 * - Slot availability changes constantly → short staleTime, refetched on focus and
 *   on every date change, never persisted.
 */
export const qk = {
  explore: (p: ExploreParams) => ['explore', p] as const,
  venue: (id: string) => ['venue', id] as const,
  slots: (id: string, day: DayKey) => ['slots', id, day] as const,
  saved: ['saved'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  notifications: ['notifications'] as const,
  hold: (id: string) => ['hold', id] as const,
  requests: ['requests'] as const,
  reviews: (id: string) => ['reviews', id] as const,
  places: ['places'] as const,
  myHolds: ['my-holds'] as const,
  // Under 'explore' so realtime refreshes and the optimistic favourite reach the paged lists too.
  exploreFeed: (p: ExploreParams) => ['explore', 'feed', p] as const,
  bookingPages: (f: BookingFilter) => ['bookings', 'pages', f] as const,
  matches: (p: MatchFeedParams) => ['matches', p] as const,
  match: (id: string) => ['match', id] as const,
  matchManage: (id: string) => ['match-manage', id] as const,
};

export const PERSISTED_ROOTS = new Set(['venue', 'saved', 'bookings', 'booking', 'places']);

export function useExplore(p: ExploreParams, enabled = true) {
  return useQuery({
    queryKey: qk.explore(p),
    enabled,
    queryFn: ({ signal }) => api.explore(p, signal), // signal aborts stale debounced searches
    staleTime: 60_000,
    placeholderData: keepPreviousData, // no flicker while filters change
  });
}

export function useVenue(id: string) {
  return useQuery({ queryKey: qk.venue(id), queryFn: ({ signal }) => api.getVenue(id, signal), staleTime: 5 * 60_000 });
}

/** `live`: realtime is connected, so polling is only a slow safety net; otherwise poll fast. */
export function useSlots(id: string, day: DayKey, live = false) {
  return useQuery({
    queryKey: qk.slots(id, day),
    queryFn: ({ signal }) => api.getSlots(id, day, signal),
    staleTime: live ? 30_000 : 4_000,
    refetchInterval: live ? 60_000 : 5_000,
    placeholderData: keepPreviousData,
  });
}

/** Warm the cache when the user starts pressing a card — the detail screen opens instantly. */
export function prefetchVenue(qc: QueryClient, v: VenueSummary) {
  qc.prefetchQuery({ queryKey: qk.venue(v.id), queryFn: ({ signal }) => api.getVenue(v.id, signal), staleTime: 5 * 60_000 });
  if (typeof v.photo === 'string') Image.prefetch(v.photo, 'memory-disk');
}

export function useSaved() {
  return useQuery({ queryKey: qk.saved, queryFn: ({ signal }) => api.getSaved(signal), staleTime: 60_000 });
}

/** Optimistic favourite toggle: UI updates instantly, rolls back if the request fails. */
export function useToggleSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ venueId, value }: { venueId: string; value: boolean }) => api.setSaved(venueId, value),
    onMutate: ({ venueId, value }) => {
      beginSaved(venueId, value); // icon flips this frame
      // Stop in-flight refetches from overwriting the optimistic value (no await: keep it synchronous).
      void qc.cancelQueries({ queryKey: ['explore'] });
      void qc.cancelQueries({ queryKey: qk.venue(venueId) });
      const snapshot = [
        ...qc.getQueriesData({ queryKey: ['explore'] }),
        ...qc.getQueriesData({ queryKey: qk.saved }),
        ...qc.getQueriesData({ queryKey: qk.venue(venueId) }),
      ];
      const flip = (v: VenueSummary) => (v.id === venueId ? { ...v, isSaved: value } : v);
      const flipPage = (p: api.ExploreLike) => ({ ...p, near: p.near.map(flip), further: p.further.map(flip) });
      qc.setQueriesData<api.ExploreLike | InfiniteData<api.ExploreLike>>({ queryKey: ['explore'] }, (old) =>
        !old ? old : 'pages' in old ? { ...old, pages: old.pages.map(flipPage) } : flipPage(old),
      );
      qc.setQueryData<VenueSummary[]>(qk.saved, (old) => (old && !value ? old.filter((v) => v.id !== venueId) : old));
      qc.setQueryData<VenueDetail>(qk.venue(venueId), (old) => (old ? { ...old, isSaved: value } : old));
      return { snapshot };
    },
    onError: (_e, { venueId }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      endSaved(venueId, true);
    },
    onSuccess: (_d, { venueId }) => {
      // Refresh in the background; keep the override until fresh data has landed.
      Promise.all([qc.invalidateQueries({ queryKey: qk.saved }), qc.invalidateQueries({ queryKey: qk.venue(venueId) })]).finally(() =>
        endSaved(venueId, false),
      );
    },
  });
}

export function useBookings() {
  return useQuery({ queryKey: qk.bookings, queryFn: ({ signal }) => api.getBookings(signal), staleTime: 30_000 });
}

export function useBooking(id: string) {
  const qc = useQueryClient();
  return useQuery<Booking>({
    queryKey: qk.booking(id),
    queryFn: ({ signal }) => api.getBooking(id, signal),
    staleTime: 60_000,
    // Opened from My bookings: show that card's copy (all its slots included) at once, then refresh.
    placeholderData: (): Booking | undefined => {
      for (const [, data] of qc.getQueriesData<InfiniteData<BookingPage>>({ queryKey: ['bookings', 'pages'] })) {
        for (const pg of data?.pages ?? []) {
          const hit = pg.next?.id === id ? pg.next : pg.items.find((b) => b.id === id || b.group?.some((g) => g.id === id));
          if (hit && hit.id === id) return hit;
        }
      }
      return undefined;
    },
  });
}

export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: ({ signal }) => api.getNotifications(signal), staleTime: 60_000 });
}

/** Hold + server-computed quote. Seeded from createHold; refetched from the server if missing. */
export function useHold(holdId: string | undefined) {
  return useQuery({
    queryKey: qk.hold(holdId ?? ''),
    queryFn: () => api.getHold(holdId!),
    enabled: !!holdId,
    staleTime: Infinity,
    gcTime: 15 * 60_000,
  });
}

export function useRequests() {
  return useQuery({ queryKey: qk.requests, queryFn: ({ signal }) => api.getRequests(signal), staleTime: 30_000 });
}

export function useReviews(venueId: string, enabled = true) {
  return useQuery({
    queryKey: qk.reviews(venueId),
    queryFn: ({ signal }) => api.getReviews(venueId, signal),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/** Player cancellation (server allows it up to 24 h before kick-off and flags the refund). */
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id: string; venueId: string; day: DayKey }) => api.cancelBooking(b.id),
    onSuccess: (_d, b) => {
      qc.invalidateQueries({ queryKey: qk.booking(b.id) });
      qc.invalidateQueries({ queryKey: qk.bookings });
      qc.invalidateQueries({ queryKey: qk.slots(b.venueId, b.day) });
    },
  });
}

/** Saved locations: persisted so the location screen opens instantly. */
export function usePlaces() {
  return useQuery({ queryKey: qk.places, queryFn: ({ signal }) => api.getPlaces(signal), staleTime: 5 * 60_000 });
}

export function useSavePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, place }: { id?: string; place: SavedPlaceInput }) => (id ? api.updatePlace(id, place) : api.createPlace(place)),
    onSuccess: (saved) => {
      qc.setQueryData<SavedPlace[]>(qk.places, (old) =>
        old ? (old.some((p) => p.id === saved.id) ? old.map((p) => (p.id === saved.id ? saved : p)) : [...old, saved]) : [saved],
      );
      qc.invalidateQueries({ queryKey: qk.places });
    },
  });
}

export function useDeletePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlace(id),
    onMutate: (id) => qc.setQueryData<SavedPlace[]>(qk.places, (old) => old?.filter((p) => p.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.places }),
  });
}

/** Slots on hold for this player (the cart). Light polling keeps the badge honest as holds expire. */
export function useMyHolds(enabled = true) {
  return useQuery({
    queryKey: qk.myHolds,
    queryFn: ({ signal }) => api.getMyHolds(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled,
  });
}

/** Account settings, with an optimistic toggle (rolls back if the server refuses). */
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => api.getSettings(signal), staleTime: 5 * 60_000 });
}
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<api.Settings>(['settings']);
      qc.setQueryData<api.Settings>(['settings'], (s) => ({ notifications: true, ...s, ...patch }));
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(['settings'], ctx.prev),
    onSuccess: (s) => qc.setQueryData(['settings'], s),
  });
}

// ---- paged lists (10 at a time, next page when the list nears its end) -------

/**
 * Explore / search, 10 turfs per page. `data` is the pages merged into one result (same shape
 * as before), so screens keep their sections; `fetchNextPage` loads the next 10.
 */
export function useExploreFeed(p: ExploreParams, enabled = true) {
  const q = useExplorePages(p, enabled);
  const pages = q.data?.pages;
  const data = useMemo<ExploreResult | undefined>(
    () => (pages?.length ? { radiusKm: pages[0].radiusKm, near: pages.flatMap((x) => x.near), further: pages.flatMap((x) => x.further) } : undefined),
    [pages],
  );
  return { ...q, data };
}

function useExplorePages(p: ExploreParams, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.exploreFeed(p),
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.explore(p, signal, { cursor: pageParam, limit: api.PAGE }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useBookingPages(filter: BookingFilter) {
  return useInfiniteQuery({
    queryKey: qk.bookingPages(filter),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.getBookingPage(filter, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000, // (no placeholder: another filter's list must never show under this one)
  });
}

// ---- find players -----------------------------------------------------------

export function useMatchFeed(p: MatchFeedParams) {
  return useInfiniteQuery({
    queryKey: qk.matches(p),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.getMatches(p, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  });
}

/** Find players: your matches and bookings that can take players. Under ['matches'] so every match change refreshes it. */
/** Squads you've paid into: shown with your bookings. Under ['matches'] so it stays live. */
export function useJoinedMatches() {
  return useQuery({ queryKey: ['matches', 'joined'], queryFn: ({ signal }) => api.getJoinedMatches(signal), staleTime: 30_000 });
}

export function useMyMatches() {
  return useQuery({ queryKey: ['matches', 'mine'], queryFn: ({ signal }) => api.getMyMatches(signal), staleTime: 15_000 });
}

export function useMatch(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery<Match>({
    queryKey: qk.match(id ?? ''),
    queryFn: ({ signal }) => api.getMatch(id!, signal),
    enabled: !!id,
    staleTime: 10_000,
    // Opened from the feed: show the card's copy at once, then refresh it.
    placeholderData: (): Match | undefined => {
      for (const [, data] of qc.getQueriesData<InfiniteData<Page<Match>>>({ queryKey: ['matches'] })) {
        const hit = data?.pages?.flatMap((pg) => pg.items).find((m) => m.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
  });
}

export function useMatchManage(id: string) {
  return useQuery({ queryKey: qk.matchManage(id), queryFn: ({ signal }) => api.getMatchManage(id, signal), staleTime: 10_000 });
}

/** Everything that shows a match: refresh after any change to one. */
function touchMatches(qc: QueryClient, id: string, manage?: MatchManage) {
  if (manage) qc.setQueryData(qk.matchManage(id), manage);
  void qc.invalidateQueries({ queryKey: ['matches'] });
  void qc.invalidateQueries({ queryKey: qk.match(id) });
  void qc.invalidateQueries({ queryKey: qk.notifications });
}

export function useJoinMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, position, level, spots }: { id: string; position: MatchPosition; level: MatchLevel; spots: number }) => api.joinMatch(id, { position, level, spots }),
    onSuccess: (m) => {
      qc.setQueryData(qk.match(m.id), m);
      touchMatches(qc, m.id);
    },
  });
}

export function useLeaveMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.leaveMatch(id),
    onSuccess: (m) => {
      qc.setQueryData(qk.match(m.id), m);
      touchMatches(qc, m.id);
    },
  });
}

export function useDecideRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, accept }: { userId: string; accept: boolean }) => api.decideRequest(id, userId, accept),
    onSuccess: (m) => touchMatches(qc, id, m),
  });
}

export function useUpdateMatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; paused?: boolean }) => api.updateMatch(id, patch),
    onSuccess: (m) => touchMatches(qc, id, m),
  });
}

export function useCreateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { bookingId: string; title?: string; level: MatchLevel; openSpots: number }) => api.createMatch(b),
    onSuccess: (m, b) => {
      touchMatches(qc, m.id);
      void qc.invalidateQueries({ queryKey: qk.booking(b.bookingId) });
    },
  });
}
