import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { qk, useMyHolds } from './queries';

/**
 * The cart is the slot you're holding (up to 5 min). `open()` jumps straight
 * to its checkout; there is no separate cart page.
 */
export function useCart() {
  const qc = useQueryClient();
  const holds = useMyHolds().data ?? []; // the server lists only unexpired holds
  const hold = holds.reduce<(typeof holds)[number] | undefined>((a, h) => (!a || h.expiresAt > a.expiresAt ? h : a), undefined);
  // Drop the badge the moment the hold runs out (polling alone could lag 30 s).
  const expiresAt = hold?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: qk.myHolds }), Math.max(0, expiresAt - Date.now()) + 500);
    return () => clearTimeout(t);
  }, [expiresAt, qc]);
  const open = () => {
    if (!hold) return false;
    qc.setQueryData(qk.hold(hold.holdId), hold);
    router.push({ pathname: '/checkout', params: { holdId: hold.holdId } });
    return true;
  };
  return { hold, count: holds.length, open };
}
