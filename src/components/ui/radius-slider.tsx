import { BlurView } from 'expo-blur';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ViewInstance } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, radius as r, space } from '@/theme/tokens';

import { Text } from './text';

/**
 * Distance filter: a ruler with a tick per kilometre (5–50 km) and labelled
 * majors every 5 km. The needle follows the finger, snaps to 5 km steps, and
 * ticks with a light haptic on every step. While dragging, the whole screen
 * blurs behind a large readout so the number is the only thing in focus.
 */
export const RADIUS_MIN = 5;
export const RADIUS_MAX = 50;
const STEP = 5;
const PAD = 14; // keeps the needle's knob inside the card at both ends
const TICKS = Array.from({ length: RADIUS_MAX - RADIUS_MIN + 1 }, (_, i) => RADIUS_MIN + i);

const snap = (km: number) => {
  'worklet';
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(km / STEP) * STEP));
};
const kmAt = (x: number, w: number) => {
  'worklet';
  return RADIUS_MIN + (Math.min(Math.max(x, 0), w) / Math.max(w, 1)) * (RADIUS_MAX - RADIUS_MIN);
};
const xAt = (km: number, w: number) => ((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * w;

type Shared = { x: SharedValue<number>; w: SharedValue<number>; innerW: number };

/** The ruler itself (no gestures), so the drag overlay can draw an identical copy above the blur. */
function Ruler({ s, preview, live, onLayout }: { s: Shared; preview: number; live: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  const fill = useAnimatedStyle(() => ({ width: s.x.get() + PAD }));
  const needle = useAnimatedStyle(() => ({ transform: [{ translateX: s.x.get() }] }));

  const ticks = (active: boolean) => (
    <View style={styles.ticks} pointerEvents="none">
      {TICKS.map((km) => {
        const major = km % STEP === 0;
        return <View key={km} style={[styles.tick, major && styles.tickMajor, active && styles.tickActive]} />;
      })}
    </View>
  );

  return (
    <View style={styles.ruler} onLayout={onLayout}>
      {/* grey scale, then the inked part clipped to the needle */}
      {ticks(false)}
      <Animated.View style={[styles.clip, fill]} pointerEvents="none">
        <View style={[styles.clipInner, { width: s.innerW }]}>{ticks(true)}</View>
      </Animated.View>
      <View style={styles.labels} pointerEvents="none">
        {TICKS.filter((km) => km % 10 === 0 || km === RADIUS_MIN).map((km) => (
          <Text
            key={km}
            variant="caption"
            color={km === preview ? colors.text : colors.textSubtle}
            style={[styles.label, { left: `${((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * 100}%` }]}>
            {km}
          </Text>
        ))}
      </View>
      <Animated.View style={[styles.needleWrap, needle]} pointerEvents="none">
        <View style={[styles.needle, live && styles.needleLive]} />
        <View style={[styles.knob, live && styles.knobLive]} />
      </Animated.View>
    </View>
  );
}

/**
 * Returns the slider and its drag overlay separately: the slider goes in the
 * scrolling header, the overlay at the screen root so its blur covers everything.
 */
export function useRadiusSlider(value: number, onCommit: (km: number) => void): { slider: ReactNode; overlay: ReactNode } {
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const [innerW, setInnerW] = useState(0);
  const last = useSharedValue(value);
  const [preview, setPreview] = useState(value);
  const [drag, setDrag] = useState<null | { top: number; left: number; width: number }>(null);
  const box = useRef<ViewInstance>(null);
  const s = { x, w, innerW };

  // Follow external changes (e.g. "Clear filters") when not dragging.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setPreview(value);
  }

  const onLayout = (e: LayoutChangeEvent) => {
    // Measured on the ruler itself, so ticks, labels and needle share one width.
    const inner = e.nativeEvent.layout.width;
    setInnerW(inner);
    w.set(inner);
    x.set(xAt(preview, inner));
  };

  const begin = () => {
    haptic.select();
    box.current?.measureInWindow((left, top, width) => setDrag({ left, top, width }));
  };
  const step = (km: number) => {
    haptic.select();
    setPreview(km);
  };
  const end = (km: number) => {
    setDrag(null);
    setPreview(km);
    if (km !== value) onCommit(km);
  };

  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-14, 14], // vertical swipes still scroll the page
    onActivate: (e) => {
      'worklet';
      x.set(Math.min(Math.max(e.x - PAD, 0), w.get()));
      scheduleOnRN(begin);
    },
    onUpdate: (e) => {
      'worklet';
      x.set(Math.min(Math.max(e.x - PAD, 0), w.get()));
      const km = snap(kmAt(x.get(), w.get()));
      if (km !== last.get()) {
        last.set(km);
        scheduleOnRN(step, km);
      }
    },
    onDeactivate: () => {
      'worklet';
      const km = snap(kmAt(x.get(), w.get()));
      last.set(km);
      x.set(withSpring(((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * w.get(), { damping: 22, stiffness: 320 }));
      scheduleOnRN(end, km);
    },
  });

  const slider = (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text variant="overline" color={colors.textMuted}>
          Search radius
        </Text>
        <Text variant="labelStrong">
          Within <Text variant="labelStrong">{preview} km</Text>
        </Text>
      </View>
      <GestureDetector gesture={pan}>
        <View
          ref={box}
          style={styles.touch}
          accessibilityRole="adjustable"
          accessibilityLabel="Search radius"
          accessibilityValue={{ min: RADIUS_MIN, max: RADIUS_MAX, now: preview, text: `${preview} kilometres` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const km = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, value + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP)));
            x.set(withSpring(xAt(km, w.get())));
            end(km);
          }}>
          <Ruler s={s} preview={preview} live={!!drag} onLayout={onLayout} />
        </View>
      </GestureDetector>
    </View>
  );
  return { slider, overlay: drag ? <DragOverlay rect={drag} s={s} preview={preview} /> : null };
}

/** Full-screen blur with a big readout; an exact copy of the ruler sits above it at the same spot. */
function DragOverlay({ rect, s, preview }: { rect: { top: number; left: number; width: number }; s: Shared; preview: number }) {
  return (
    <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(180)} style={styles.overlay} pointerEvents="none">
      {Platform.OS === 'ios' ? (
        <BlurView intensity={28} tint="systemThinMaterialLight" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.androidFrost]} />
      )}
      <View style={[styles.readout, { top: Math.max(rect.top - 170, 40) }]}>
        <Text variant="display" style={styles.readoutNumber}>
          {preview}
          <Text variant="h2" color={colors.textMuted}>
            {' '}
            km
          </Text>
        </Text>
        <Text variant="label" color={colors.textMuted}>
          Turfs within {preview} km of you
        </Text>
      </View>
      <View style={[styles.copy, { top: rect.top, left: rect.left, width: rect.width }]}>
        <Ruler s={s} preview={preview} live />
      </View>
    </Animated.View>
  );
}

const TICK_W = 1.5;
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: space[3],
    paddingBottom: space[2],
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4] },
  touch: { paddingHorizontal: PAD, paddingTop: space[2] },
  ruler: { height: 66 },
  ticks: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    height: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  tick: { width: TICK_W, height: 10, borderRadius: 1, backgroundColor: colors.borderStrong },
  tickMajor: { height: 22, width: 2 },
  tickActive: { backgroundColor: colors.ink },
  clip: { position: 'absolute', left: -PAD, top: 0, bottom: 0, overflow: 'hidden' },
  // same box as the grey scale, offset back by the padding so ticks line up exactly
  clipInner: { position: 'absolute', left: PAD, top: 0, bottom: 0 },
  labels: { position: 'absolute', left: 0, right: 0, top: 46 },
  label: { position: 'absolute', width: 28, marginLeft: -14, textAlign: 'center' },
  needleWrap: { position: 'absolute', left: -11, top: 6, width: 22, alignItems: 'center' },
  needle: { width: 2.5, height: 34, borderRadius: 2, backgroundColor: colors.ink },
  needleLive: { height: 36 },
  knob: {
    position: 'absolute',
    top: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.lime,
    borderWidth: 3,
    borderColor: colors.ink,
  },
  knobLive: { transform: [{ scale: 1.15 }] },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 50 },
  androidFrost: { backgroundColor: 'rgba(244,245,240,0.88)' },
  readout: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: space[1] },
  readoutNumber: { fontVariant: ['tabular-nums'] },
  copy: { position: 'absolute', paddingHorizontal: PAD, paddingTop: space[2] },
});
