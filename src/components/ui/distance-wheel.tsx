import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, gutter, space } from '@/theme/tokens';

import { Button } from './button';
import { IconButton } from './icon-button';
import { Text } from './text';

/**
 * Distance picker modelled on the camera zoom dial, turned on its side: a big
 * dark disc against the right edge that the right thumb rolls up and down.
 *
 * Like the camera dial the scale is uneven: short distances get more room,
 * long ones bunch up (angle ∝ km^0.7), so 5→50 km is about a 90° turn.
 * Labels thin out where the scale tightens (every 5 km up to 20, then every
 * 10); 25/35/45 are plain marks, the pointer and the readout name them.
 * The face runs from 0 so the top never looks empty, but you can't pick
 * below 5 km. Everything during a drag runs on the UI thread; React only
 * re-renders when the value crosses a 5 km detent.
 */
export const DISTANCES = Array.from({ length: 10 }, (_, i) => (i + 1) * 5);
export const DEFAULT_DISTANCE = 5;
const MIN = DISTANCES[0];
const MAX = DISTANCES[DISTANCES.length - 1];
const POW = 0.7;
const SPAN_DEG = 115; // 0 → 50 km
const K = SPAN_DEG / Math.pow(MAX, POW);

/** km → dial angle (deg) */
function angleOf(km: number) {
  'worklet';
  return K * Math.pow(Math.max(0, km), POW);
}
/** dial angle (deg) → km */
function kmOf(deg: number) {
  'worklet';
  return Math.pow(Math.max(0, deg) / K, 1 / POW);
}

// ½ km marks where there's room (under 10 km), 1 km marks beyond.
const TICKS = [
  ...Array.from({ length: 20 }, (_, i) => i / 2),
  ...Array.from({ length: MAX - 10 + 1 }, (_, i) => 10 + i),
];
const labelled = (km: number) => km <= 20 || km % 10 === 0;
const LABELS = [0, ...DISTANCES].filter(labelled);
const SPRING = { damping: 22, stiffness: 220, mass: 0.7 };

/** The static face: built once, then only the whole layer rotates. */
const DialFace = memo(function DialFace({ R }: { R: number }) {
  return (
    <>
      {TICKS.map((km) => {
        const major = km % 5 === 0 && labelled(km);
        const mid = km % 5 === 0 && !major;
        const whole = Number.isInteger(km);
        return (
          <View
            key={km}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-angleOf(km)}deg` }] }]}>
            <View
              style={[
                styles.tick,
                major ? styles.tickMajor : mid ? styles.tickMid : whole ? styles.tickWhole : styles.tickHalf,
                { top: R - (major || mid ? 1 : 0.5) },
                km < MIN && styles.tickDim,
              ]}
            />
          </View>
        );
      })}
    </>
  );
});

const Label = memo(function Label({ km, R, a, active }: { km: number; R: number; a: SharedValue<number>; active: boolean }) {
  const at = angleOf(km);
  // keep the number upright while the disc turns
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${at - a.get()}deg` }] }));
  const dim = km < MIN;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-at}deg` }] }]}>
      <Animated.View style={[styles.label, { top: R - 22 }, upright]}>
        <Text variant="h3" color={active ? colors.lime : dim ? colors.textOnDarkMuted : colors.textOnDark} style={styles.labelText}>
          {km}
        </Text>
        <Text variant="caption" color={active ? colors.lime : colors.textOnDarkMuted} style={styles.labelUnit}>
          KM
        </Text>
      </Animated.View>
    </View>
  );
});

export function DistanceWheel({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: number;
  onApply: (km: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const R = Math.round(Math.min(height * 0.42, 380)); // disc radius
  const pointerX = Math.round(width * 0.44); // where the rim (and pointer) sits
  const cy = Math.round(height * 0.47);

  const a = useSharedValue(angleOf(value)); // dial angle in degrees, the only thing that moves
  const start = useSharedValue(0);
  const lastKm = useSharedValue(value);
  const lastDetent = useSharedValue(value);
  const lastClickAt = useSharedValue(0);
  const [pick, setPick] = useState(value);

  // Reset to the current value every time the picker opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPick(value);
      a.set(angleOf(value));
      lastKm.set(value);
      lastDetent.set(value);
    }
  }

  const click = () => haptic.select();
  const detent = (km: number) => setPick(km);
  const settle = (km: number) => {
    haptic.tap();
    setPick(km);
  };

  const lo = angleOf(MIN);
  const hi = angleOf(MAX);
  const degPerPx = 180 / (Math.PI * R); // the rim moves exactly with the thumb

  const pan = usePanGesture({
    minDistance: 1,
    onActivate: () => {
      'worklet';
      start.set(a.get());
    },
    onUpdate: (e) => {
      'worklet';
      let next = start.get() - e.translationY * degPerPx; // thumb up → further
      // rubber-band past the ends
      if (next < lo) next = lo - (lo - next) * 0.3;
      if (next > hi) next = hi + (next - hi) * 0.3;
      a.set(next);

      const km = Math.round(kmOf(next));
      if (km !== lastKm.get() && km >= MIN && km <= MAX) {
        lastKm.set(km);
        const now = Date.now();
        if (now - lastClickAt.get() > 28) {
          lastClickAt.set(now);
          scheduleOnRN(click);
        }
      }
      const d = Math.min(MAX, Math.max(MIN, Math.round(kmOf(next) / 5) * 5));
      if (d !== lastDetent.get()) {
        lastDetent.set(d);
        scheduleOnRN(detent, d);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      const projected = a.get() - e.velocityY * degPerPx * 0.12; // a flick carries on a little
      const target = Math.min(MAX, Math.max(MIN, Math.round(kmOf(projected) / 5) * 5));
      a.set(withSpring(angleOf(target), SPRING));
      lastKm.set(target);
      lastDetent.set(target);
      scheduleOnRN(settle, target);
    },
  });

  const discStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${a.get()}deg` }] }));

  const nudge = (dir: 1 | -1) => {
    const km = Math.min(MAX, Math.max(MIN, pick + dir * 5));
    a.set(withSpring(angleOf(km), SPRING));
    settle(km);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={40} tint="systemThinMaterialLight" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.frost]} />
        )}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        {/* the dial */}
        <Animated.View entering={FadeIn.duration(240)} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            pointerEvents="none"
            style={[styles.disc, { left: pointerX, top: cy - R, width: R * 2, height: R * 2, borderRadius: R }]}>
            <Animated.View style={[StyleSheet.absoluteFill, discStyle]}>
              <DialFace R={R} />
              {LABELS.map((km) => (
                <Label key={km} km={km} R={R} a={a} active={km === pick} />
              ))}
            </Animated.View>
          </View>
          {/* pointer: lime notch on the rim, pointing into the dial */}
          <View pointerEvents="none" style={[styles.pointer, { left: pointerX - 13, top: cy - 7 }]} />
          <View pointerEvents="none" style={[styles.pointerLine, { left: pointerX, top: cy - 1.5 }]} />

          {/* the readout, left of the pointer */}
          <View pointerEvents="none" style={[styles.readout, { top: cy - 48, width: pointerX - gutter - space[3] }]}>
            <Text variant="display" style={styles.readoutValue}>
              {pick}
              <Text variant="h3"> km</Text>
            </Text>
            <Text variant="label" color={colors.textMuted}>
              from you
            </Text>
          </View>

          {/* touch area: the whole right side, so the thumb can roll it from anywhere */}
          <GestureDetector gesture={pan}>
            <View
              style={[styles.touch, { left: pointerX - 24, top: insets.top + 80, bottom: insets.bottom + 110 }]}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Distance"
              accessibilityValue={{ min: MIN, max: MAX, now: pick, text: `${pick} kilometres` }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
            />
          </GestureDetector>
        </Animated.View>

        <View style={[styles.top, { paddingTop: insets.top + space[3] }]} pointerEvents="box-none">
          <View style={styles.flex}>
            <Text variant="overline" color={colors.textMuted}>
              Distance
            </Text>
            <Text variant="h2">How far will you go?</Text>
          </View>
          <IconButton icon={X} label="Close" onPress={onClose} />
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + space[5] }]} pointerEvents="box-none">
          <Text variant="label" color={colors.textMuted} align="center">
            Roll the dial with your thumb
          </Text>
          <Button
            label={`Apply · ${pick} km`}
            onPress={() => {
              onApply(pick);
              onClose();
            }}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frost: { backgroundColor: 'rgba(244,245,240,0.94)' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingHorizontal: gutter },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: gutter, gap: space[3] },
  disc: { position: 'absolute', backgroundColor: 'rgba(22,27,29,0.72)', overflow: 'hidden' },
  tick: { position: 'absolute', left: 0, backgroundColor: colors.textOnDark },
  tickMajor: { width: 26, height: 2, opacity: 1 },
  tickMid: { width: 20, height: 2, opacity: 0.9 },
  tickWhole: { width: 12, height: 1, opacity: 0.7 },
  tickHalf: { width: 8, height: 1, opacity: 0.4 },
  tickDim: { opacity: 0.25 },
  label: { position: 'absolute', left: 34, width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  labelText: { lineHeight: 24 },
  labelUnit: { fontSize: 9, letterSpacing: 1, lineHeight: 12 },
  pointer: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.lime,
  },
  pointerLine: { position: 'absolute', width: 30, height: 3, borderRadius: 2, backgroundColor: colors.lime },
  readout: { position: 'absolute', left: gutter, alignItems: 'flex-end' },
  readoutValue: { fontVariant: ['tabular-nums'] },
  touch: { position: 'absolute', right: 0 },
});
