import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { KNOWN_AREAS } from '@/features/api/mock-db';
import type { User } from '@/features/api/types';
import { prefs, secure } from '@/lib/storage';

type Place = { name: string; city: string; lat: number; lng: number; source: 'gps' | 'manual' };

type SessionState = {
  ready: boolean;
  onboarded: boolean;
  user: User | null;
  place: Place;
  completeOnboarding: () => void;
  signIn: (user: User, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPlace: (p: Place) => void;
};

const SessionContext = createContext<SessionState | null>(null);
const DEFAULT_PLACE: Place = { ...KNOWN_AREAS[0], source: 'manual' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [place, setPlaceState] = useState<Place>(DEFAULT_PLACE);

  useEffect(() => {
    // All reads in parallel so start-up is a single round trip to storage.
    Promise.all([prefs.get('ts.onboarded'), prefs.get('ts.user'), secure.get('ts.token'), prefs.get('ts.place')])
      .then(([ob, u, token, p]) => {
        setOnboarded(ob === '1');
        if (u && (token || process.env.EXPO_OS === 'web')) setUser(JSON.parse(u));
        if (p) setPlaceState(JSON.parse(p));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    prefs.set('ts.onboarded', '1');
  }, []);

  const signIn = useCallback(async (u: User, token: string) => {
    await secure.set('ts.token', token);
    await prefs.set('ts.user', JSON.stringify(u)); // profile only, no secrets
    setOnboarded(true);
    prefs.set('ts.onboarded', '1');
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await secure.remove('ts.token');
    await prefs.remove('ts.user');
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
