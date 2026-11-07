import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

/**
 * False while this screen's opening animation runs, then true.
 *
 * A screen that builds everything on its first render blocks the UI thread for longer than
 * a 150 ms transition, so the animation is skipped (it "pops" in). Render a light first frame
 * while this is false and the heavy parts once it flips: the transition gets every frame.
 * Falls back to a timer in case the navigator sends no transition event.
 */
export function useTransitionSettled(fallbackMs = 350) {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    const t = setTimeout(done, fallbackMs);
    // `transitionEnd` exists on stack navigators; the cast keeps this hook navigator-agnostic.
    const off = (navigation as unknown as { addListener: (e: string, cb: (ev: { data?: { closing?: boolean } }) => void) => () => void }).addListener(
      'transitionEnd',
      (e) => {
        if (!e.data?.closing) done();
      },
    );
    return () => {
      clearTimeout(t);
      off?.();
    };
  }, [navigation, settled, fallbackMs]);
  return settled;
}
