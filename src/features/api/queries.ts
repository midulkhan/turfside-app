import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';

import type { DayKey } from '@/lib/time';

import * as api from './client';
import { beginSaved, endSaved } from './saved-store';
import type { ExploreParams, VenueDetail, VenueSummary } from './types';

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
};

export const PERSISTED_ROOTS = new Set(['venue', 'saved', 'bookings', 'booking']);

export function useExplore(p: ExploreParams) {
  return useQuery({
    queryKey: qk.explore(p),
    queryFn: ({ signal }) => api.explore(p, signal), // signal aborts stale debounced searches
    staleTime: 60_000,
    placeholderData: keepPreviousData, // no flicker while filters change
  });
}

export function useVenue(id: string) {
  return useQuery({ queryKey: qk.venue(id), queryFn: ({ signal }) => api.getVenue(id, signal), staleTime: 5 * 60_000 });
}

export function useSlots(id: string, day: DayKey) {
  return useQuery({
    queryKey: qk.slots(id, day),
    queryFn: ({ signal }) => api.getSlots(id, day, signal),
    staleTime: 15_000,
    refetchInterval: 30_000, // keep availability honest while the user decides
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
      qc.setQueriesData<api.ExploreLike>({ queryKey: ['explore'] }, (old) =>
        old ? { ...old, near: old.near.map(flip), further: old.further.map(flip) } : old,
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
  return useQuery({ queryKey: qk.booking(id), queryFn: ({ signal }) => api.getBooking(id, signal), staleTime: 60_000 });
}

export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: ({ signal }) => api.getNotifications(signal), staleTime: 60_000 });
}

/** Hold + server-computed quote. Seeded from createHold; refetched from the server if missing. */
export function useHold(holdId: string) {
  return useQuery({ queryKey: qk.hold(holdId), queryFn: () => api.getHold(holdId), staleTime: Infinity, gcTime: 15 * 60_000 });
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
