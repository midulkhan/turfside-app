import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, gutter, space } from '@/theme/tokens';

import { Button } from './button';
import { IconButton } from './icon-button';
import { Text } from './text';

/**
 * Distance picker modelled on the camera zoom dial, turned on its side: a big
 * dark disc sits against the right edge so the right thumb rolls it up and
 * down. Fine ticks every ½ km, labelled ticks every 5 km, a lime pointer on the
 * rim. Every kilometre clicks (haptic); on release it settles on the nearest
 * 5 km with a little momentum, like a real detented dial.
 */
export const DISTANCES = Array.from({ length: 10 }, (_, i) => (i + 1) * 5);
export const DEFAULT_DISTANCE = 5;
const MIN = DISTANCES[0];
const MAX = DISTANCES[DISTANCES.length - 1];
const DEG_PER_KM = 3.2; // the whole 5–50 km range spans 144° of the dial
const HALF_TICKS = Array.from({ length: (MAX - MIN) * 2 + 1 }, (_, i) => MIN + i / 2);

function Tick({ km, R }: { km: number; R: number }) {
  const major = km % 5 === 0;
  const whole = Number.isInteger(km);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-(km - MIN) * DEG_PER_KM}deg` }] }]}>
      <View
        style={[
          styles.tick,
          major ? styles.tickMajor : whole ? styles.tickWhole : styles.tickHalf,
          { top: R - (major ? 1 : 0.5) },
        ]}
      />
    </View>
  );
}

function Label({ km, R, v, active }: { km: number; R: number; v: SharedValue<number>; active: boolean }) {
  // keep the number upright while the disc turns
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${(km - v.get()) * DEG_PER_KM}deg` }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-(km - MIN) * DEG_PER_KM}deg` }] }]}>
      <Animated.View style={[styles.label, { top: R - 22 }, upright]}>
        <Text variant="h3" color={active ? colors.lime : colors.textOnDark} style={styles.labelText}>
          {km}
        </Text>
        <Text variant="caption" color={active ? colors.lime : colors.textOnDarkMuted} style={styles.labelUnit}>
          KM
        </Text>
      </Animated.View>
    </View>
  );
}

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
  const pxPerKm = (R * DEG_PER_KM * Math.PI) / 180; // arc length the thumb travels per km

  const v = useSharedValue(value); // live dial position in km (fractional while turning)
  const start = useSharedValue(value);
  const lastKm = useSharedValue(value);
  const [pick, setPick] = useState(value);

  // Reset to the current value every time the picker opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPick(value);
      v.set(value);
      lastKm.set(value);
    }
  }

  const click = (km: number) => {
    haptic.select();
    setPick(Math.min(MAX, Math.max(MIN, Math.round(km / 5) * 5)));
  };
  const settle = (km: number) => {
    haptic.tap();
    setPick(km);
  };

  const pan = usePanGesture({
    minDistance: 2,
    onActivate: () => {
      'worklet';
      start.set(v.get());
    },
    onUpdate: (e) => {
      'worklet';
      let next = start.get() - e.translationY / pxPerKm; // thumb up → further
      // rubber-band past the ends
      if (next < MIN) next = MIN - (MIN - next) * 0.25;
      if (next > MAX) next = MAX + (next - MAX) * 0.25;
      v.set(next);
      const km = Math.round(next);
      if (km !== lastKm.get() && km >= MIN && km <= MAX) {
        lastKm.set(km);
        scheduleOnRN(click, km);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      const projected = v.get() - (e.velocityY / pxPerKm) * 0.12; // a flick carries on a little
      const target = Math.min(MAX, Math.max(MIN, Math.round(projected / 5) * 5));
      v.set(withSpring(target, { damping: 20, stiffness: 180, mass: 0.8 }));
      lastKm.set(target);
      scheduleOnRN(settle, target);
    },
  });

  const spin = useDerivedValue(() => (v.get() - MIN) * DEG_PER_KM);
  const discStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));

  const nudge = (dir: 1 | -1) => {
    const km = Math.min(MAX, Math.max(MIN, pick + dir * 5));
    v.set(withSpring(km, { damping: 20, stiffness: 180 }));
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
              {HALF_TICKS.map((km) => (
                <Tick key={km} km={km} R={R} />
              ))}
              {DISTANCES.map((km) => (
                <Label key={km} km={km} R={R} v={v} active={km === pick} />
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
  tickWhole: { width: 14, height: 1, opacity: 0.75 },
  tickHalf: { width: 8, height: 1, opacity: 0.4 },
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
