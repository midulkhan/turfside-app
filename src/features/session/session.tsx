import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as api from '@/features/api/client';
import { tokens } from '@/features/api/tokens';
import type { AuthResult, User } from '@/features/api/types';
import { KNOWN_AREAS } from '@/lib/places';
import { persister, queryClient } from '@/lib/query-client';
import { prefs } from '@/lib/storage';

/** The location Explore searches around. `savedId` links it to a saved location. */
export type Place = { name: string; city: string; lat: number; lng: number; source: 'gps' | 'map' | 'manual' | 'saved'; savedId?: string; label?: string };

type SessionState = {
  ready: boolean;
  onboarded: boolean;
  user: User | null;
  place: Place;
  completeOnboarding: () => void;
  /** Store the tokens from sign-in / sign-up / password reset and enter the app. */
  signIn: (auth: AuthResult) => Promise<void>;
  signOut: () => Promise<void>;
  setPlace: (p: Place) => void;
};

const SessionContext = createContext<SessionState | null>(null);
const DEFAULT_PLACE: Place = { ...KNOWN_AREAS[0], source: 'manual' };

/** Drop every cached response (bookings, saved turfs…) so the next account never sees them. */
async function clearUserData() {
  queryClient.clear();
  await persister.removeClient();
  await prefs.remove('ts.user');
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [place, setPlaceState] = useState<Place>(DEFAULT_PLACE);

  useEffect(() => {
    // All reads in parallel so start-up is a single round trip to storage.
    Promise.all([prefs.get('ts.onboarded'), prefs.get('ts.user'), prefs.get('ts.place'), tokens.load()])
      .then(([ob, u, p]) => {
        setOnboarded(ob === '1');
        // A cached profile only counts if there is a refresh token to back it.
        if (u && tokens.refresh) setUser(JSON.parse(u));
        else if (u) prefs.remove('ts.user');
        if (p) setPlaceState(JSON.parse(p));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Refresh the profile in the background (roles may have changed). A revoked
  // session surfaces as an "expired" event from the HTTP layer below.
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    const ctrl = new AbortController();
    api
      .me(ctrl.signal)
      .then((u) => {
        setUser(u);
        prefs.set('ts.user', JSON.stringify(u));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [signedIn]);

  useEffect(
    () =>
      tokens.onExpired(() => {
        clearUserData().finally(() => setUser(null));
      }),
    [],
  );

  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    prefs.set('ts.onboarded', '1');
  }, []);

  const signIn = useCallback(async (auth: AuthResult) => {
    queryClient.clear(); // nothing from a previous account survives
    await tokens.set(auth.accessToken, auth.refreshToken);
    await prefs.set('ts.user', JSON.stringify(auth.user)); // profile only, no secrets
    setOnboarded(true);
    prefs.set('ts.onboarded', '1');
    setUser(auth.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {}); // revoke the refresh token server-side (best effort)
    await tokens.clear();
    await clearUserData();
    setUser(null);
  }, []);

  const setPlace = useCallback((p: Place) => {
    setPlaceState(p);
    prefs.set('ts.place', JSON.stringify(p));
  }, []);

  const value = useMemo(
    () => ({ ready, onboarded, user, place, completeOnboarding, signIn, signOut, setPlace }),
    [ready, onboarded, user, place, completeOnboarding, signIn, signOut, setPlace],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession() {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
