import { createContext, Fragment, use, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Appearance, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { prefs } from '@/lib/storage';

import * as SystemUI from 'expo-system-ui';

import { applyScheme, getScheme, palettes, type Scheme } from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';
const PREF_KEY = 'ts.theme';

type Ctx = { pref: ThemePref; scheme: Scheme; setPref: (p: ThemePref) => void };
const ThemeCtx = createContext<Ctx>({ pref: 'system', scheme: 'light', setPref: () => {} });
export const useTheme = () => use(ThemeCtx);

const systemScheme = (): Scheme => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');

/**
 * App-wide light/dark theme.
 *  - `pref` (System / Light / Dark) is saved on the device; native UI (keyboard, alerts,
 *    pickers) follows through Appearance.setColorScheme.
 *  - On a switch the palette flips, every navigator re-renders and each screen's content
 *    re-mounts in the new colours (see `themedScreen`). The navigators themselves stay mounted,
 *    so the current screen, the back history and the active tab are all kept.
 *  - A short fade in the new page colour hides the swap.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref | null>(null);
  const [system, setSystem] = useState<Scheme>(systemScheme);

  useEffect(() => {
    // Never wait on storage for long: the whole app (and the splash hand-off) sits behind this.
    Promise.race([prefs.get(PREF_KEY), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
      .then((v) => setPrefState(v === 'light' || v === 'dark' || v === 'system' ? v : 'system'))
      .catch(() => setPrefState('system'));
    // Fires for system changes and for our own overrides below.
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(colorScheme === 'dark' ? 'dark' : 'light'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Native only (keyboard, alerts, pickers); web has no app-level override.
    if (pref && typeof Appearance.setColorScheme === 'function') Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
  }, [pref]);

  const scheme: Scheme = !pref || pref === 'system' ? system : pref;
  // Flip the palette before any child of this render reads a colour (idempotent).
  if (pref) applyScheme(scheme);

  // The native window behind every screen: shown for a frame between screens and through
  // crossfades. It starts as app.json's white, so match it to the theme (no white flash).
  useEffect(() => {
    if (pref) SystemUI.setBackgroundColorAsync(palettes[scheme].bg).catch(() => {});
  }, [pref, scheme]);

  const veil = useSharedValue(0);
  const shown = useRef<Scheme | null>(null);
  useEffect(() => {
    if (!pref) return;
    if (shown.current && shown.current !== scheme) {
      veil.set(1);
      veil.set(withTiming(0, { duration: 340, easing: Easing.out(Easing.quad) }));
    }
    shown.current = scheme;
  }, [scheme, pref, veil]);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.get() }));

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    prefs.set(PREF_KEY, p).catch(() => {});
  }, []);
  const value = useMemo(() => ({ pref: pref ?? 'system', scheme, setPref }), [pref, scheme, setPref]);

  if (!pref) return null; // one quick storage read, hidden by the splash
  return (
    <ThemeCtx value={value}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palettes[scheme].bg }, veilStyle]} />
    </ThemeCtx>
  );
}

/**
 * Navigator `screenLayout` that re-mounts a screen's content when the theme changes.
 * Pass `keep` for routes that hold a nested navigator (it re-themes its own screens).
 */
export function themedScreen(scheme: Scheme, keep: string[] = []) {
  return function ThemedScreen({ route, children }: { route: { name: string }; children: ReactElement }): ReactElement {
    return keep.includes(route.name) ? children : <Fragment key={scheme}>{children}</Fragment>;
  };
}

/** Status bar content style for the page background ("dark" icons on light pages). */
export const pageStatusBar = () => (getScheme() === 'dark' ? 'light' : 'dark');
