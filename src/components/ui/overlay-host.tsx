import { BlurTargetView } from 'expo-blur';
import { createContext, use, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { createStyles } from '@/theme/styles';

/**
 * App-wide overlay layer + blur source.
 *
 * Android can only blur views that sit inside a `BlurTargetView`, and a RN
 * `Modal` is a separate window that can't see into it. So the whole app is
 * wrapped in one BlurTargetView, and full-screen overlays (like the distance
 * dial) render into a layer on top of it, in the same window, where a
 * `BlurView` pointed at `blurTarget` gives a real blur.
 */
type Target = ComponentRef<typeof View>;
type Ctx = { blurTarget: RefObject<Target | null>; set: (node: ReactNode) => void };
const OverlayContext = createContext<Ctx | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const blurTarget = useRef<Target | null>(null);
  const [node, set] = useState<ReactNode>(null);
  const ctx = useMemo<Ctx>(() => ({ blurTarget, set }), []);
  return (
    <OverlayContext value={ctx}>
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        {children}
      </BlurTargetView>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {node}
      </View>
    </OverlayContext>
  );
}

/** The ref Android BlurViews should blur (the whole app). */
export function useBlurTarget() {
  return use(OverlayContext)?.blurTarget;
}

/** Renders its children in the app-wide overlay layer while mounted. */
export function Overlay({ children }: { children: ReactNode }) {
  const ctx = use(OverlayContext);
  useLayoutEffect(() => {
    ctx?.set(children);
  }, [ctx, children]);
  useLayoutEffect(() => () => ctx?.set(null), [ctx]);
  return null;
}

const styles = createStyles(() => ({ flex: { flex: 1 } }));
