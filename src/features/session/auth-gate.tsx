/**
 * Guests can browse: turfs, their slots, search, the map and the location. Anything that needs an
 * account (booking, saving a turf, squads, notifications, bookings, profile) goes through
 * `requireAuth`: signed in, the action runs at once; signed out, a drawer asks them to sign in or
 * create an account. After signing in they come back to the same screen (picked slots and all)
 * and the action they started carries on, e.g. straight to checkout.
 *
 * The auth screens call `finishAuth()` instead of navigating themselves.
 */
import { router, usePathname, useGlobalSearchParams, type Href } from 'expo-router';
import { LogIn, UserPlus } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { createStyles } from '@/theme/styles';
import { colors, space } from '@/theme/tokens';

/** What a guest was doing when asked to sign in: where to come back to, and what to carry on with. */
type Pending = { returnTo: Href; run?: () => void };
let pending: Pending | null = null;

/**
 * Called by the auth screens once the account is signed in: back to where the person was, then
 * the action they started. With nothing pending (they opened Sign in from the menu), Explore.
 */
export function finishAuth() {
  const p = pending;
  pending = null;
  if (!p) {
    router.replace('/explore');
    return;
  }
  router.dismissTo(p.returnTo);
  // Let the screen settle before carrying on (the run may navigate further, e.g. to checkout).
  if (p.run) setTimeout(p.run, 350);
}

/** Closing the auth screens without signing in: back to where they were, nothing carried on. */
export function closeAuth() {
  const p = pending;
  pending = null;
  if (p) router.dismissTo(p.returnTo);
  else if (router.canGoBack()) router.back();
  else router.replace('/explore');
}

type Gate = {
  /**
   * Runs `run` when signed in. Signed out: opens the sign-in drawer with `why` ("Sign in to book
   * this slot") and runs `run` after they sign in. Returns whether it ran now.
   */
  requireAuth: (why: string, run?: () => void) => boolean;
};
const Ctx = createContext<Gate | null>(null);

export function useAuthGate() {
  const g = useContext(Ctx);
  if (!g) throw new Error('useAuthGate outside AuthGateProvider');
  return g;
}

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  // The open request: why, what to carry on with, and the screen it was asked from.
  const [ask, setAsk] = useState<{ why: string; pending: Pending } | null>(null);

  const requireAuth = useCallback(
    (why: string, run?: () => void) => {
      if (user) {
        run?.();
        return true;
      }
      setAsk({ why, pending: { returnTo: { pathname, params } as Href, run } });
      return false;
    },
    [user, pathname, params],
  );

  const go = (to: '/sign-in' | '/sign-up') => {
    if (!ask) return;
    pending = ask.pending;
    setAsk(null);
    // After the drawer has slid away.
    setTimeout(() => router.push(to), 220);
  };

  const value = useMemo(() => ({ requireAuth }), [requireAuth]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet visible={!!ask && !user} onClose={() => setAsk(null)}>
        <View style={styles.sheet}>
          <LogoMark height={34} />
          <View style={styles.head}>
            <Text variant="h2">{ask?.why ?? 'Sign in to continue'}</Text>
            <Text variant="body" color={colors.textMuted}>
              Booking, squads and your tickets need a TurfSides account. It takes a minute, and you’ll come right back here.
            </Text>
          </View>
          <Button label="Sign in" icon={LogIn} onPress={() => go('/sign-in')} />
          <Button label="Create an account" icon={UserPlus} variant="outline" onPress={() => go('/sign-up')} />
        </View>
      </Sheet>
    </Ctx.Provider>
  );
}

const styles = createStyles(() => ({
  sheet: { padding: space[5], gap: space[3] },
  head: { gap: space[1], marginTop: space[2], marginBottom: space[2] },
}));
