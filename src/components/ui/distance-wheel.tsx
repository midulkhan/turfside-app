import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, getScheme, gutter, space, withAlpha } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { Button } from './button';
import { IconButton } from './icon-button';
import { Overlay, useBlurTarget } from './overlay-host';
import { Text } from './text';

/**
 * Distance picker modelled on the camera zoom dial, turned on its side: a big
 * dark disc against the right edge that the right thumb rolls up and down.
 *
 * Like the camera dial the scale is gently uneven (angle ∝ km^0.8): early
 * kilometres get a little more room, later ones tighten, but the rhythm
 * never breaks. Every 5 km is numbered with a two-level hierarchy — tens big
 * with a KM caption, fives small and lighter — and the numbers fall off in
 * size and brightness away from the pointer, like a curved bezel catching
 * light. The face runs from 0 so the top never looks empty, but you can't
 * pick below 5 km. Dragging runs on the UI thread only; React re-renders
 * just when the value crosses a 5 km detent.
 */
export const DISTANCES = Array.from({ length: 10 }, (_, i) => (i + 1) * 5);
export const DEFAULT_DISTANCE = 5;
const MIN = DISTANCES[0];
const MAX = DISTANCES[DISTANCES.length - 1];
const POW = 0.8;
const SPAN_DEG = 100; // 0 → 50 km
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
const TICKS = [...Array.from({ length: 20 }, (_, i) => i / 2), ...Array.from({ length: MAX - 10 + 1 }, (_, i) => 10 + i)];
const LABELS = [0, ...DISTANCES];
const isTen = (km: number) => km % 10 === 0;
const SPRING = { damping: 22, stiffness: 220, mass: 0.7 };

/** The static face: built once, then only the whole layer rotates. */
const DialFace = memo(function DialFace({ R }: { R: number }) {
  return (
    <>
      {TICKS.map((km) => {
        const major = isTen(km);
        const mid = km % 5 === 0 && !major;
        const whole = Number.isInteger(km);
        return (
          <View key={km} pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-angleOf(km)}deg` }] }]}>
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
  const ten = isTen(km);
  // Upright while the disc turns, and falling off away from the pointer.
  const style = useAnimatedStyle(() => {
    const off = Math.abs(at - a.get());
    return {
      opacity: interpolate(off, [0, 30, 70], [1, 0.72, 0.18], Extrapolation.CLAMP) * (km < MIN ? 0.55 : 1),
      transform: [{ rotate: `${at - a.get()}deg` }, { scale: interpolate(off, [0, 60], [1, 0.86], Extrapolation.CLAMP) }],
    };
  });
  const fg = active ? colors.lime : ten ? colors.textOnDark : 'rgba(255,255,255,0.62)';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${-at}deg` }] }]}>
      <Animated.View style={[styles.label, { top: R - 22 }, style]}>
        <Text variant={ten ? 'h3' : 'labelStrong'} color={fg} style={ten ? styles.tenText : styles.fiveText}>
          {km}
        </Text>
        {ten ? (
          <Text variant="caption" color={active ? colors.lime : colors.textOnDarkMuted} style={styles.labelUnit}>
            KM
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
});

// Real blur needs Android 12+ (RenderNode); older phones get the frosted layer.
const androidBlur = Platform.OS === 'android' && Number(Platform.Version) >= 31;

/** Hardware back closes the overlay (a Modal would do this for us). */
function AndroidBack({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);
  return null;
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
  const blurTarget = useBlurTarget();
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

  const content = (
    <>
      {/* Pure blur (no white material), with soft fades only where text sits. */}
      {Platform.OS === 'ios' ? (
        <BlurView intensity={55} tint={getScheme()} style={StyleSheet.absoluteFill} />
      ) : androidBlur && blurTarget ? (
        <BlurView
          intensity={55}
          tint={getScheme()}
          blurTarget={blurTarget}
          blurMethod="dimezisBlurView"
          blurReductionFactor={2.2}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.frost]} />
      )}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil]} />
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(colors.bg, 0.78), withAlpha(colors.bg, 0)]}
        style={[styles.fadeTop, { height: insets.top + 140 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(colors.bg, 0), withAlpha(colors.bg, 0.8)]}
        style={[styles.fadeBottom, { height: insets.bottom + 190 }]}
      />
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

      {/* the dial */}
      <Animated.View entering={FadeIn.duration(240)} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="none" style={[styles.disc, { left: pointerX, top: cy - R, width: R * 2, height: R * 2, borderRadius: R }]}>
          <View style={[styles.innerRing, { borderRadius: R - 92, top: 92, left: 92, right: 92, bottom: 92 }]} />
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
        <View pointerEvents="none" style={[styles.readout, { top: cy - 48, width: pointerX - gutter - space[8] }]}>
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
    </>
  );

  // iOS: a native modal blurs whatever is underneath.
  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
        <GestureHandlerRootView style={styles.flex}>{content}</GestureHandlerRootView>
      </Modal>
    );
  }
  // Android: render in the app's overlay layer (same window), so the BlurView can blur the app.
  return visible ? (
    <Overlay>
      <AndroidBack onBack={onClose} />
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
        {content}
      </Animated.View>
    </Overlay>
  ) : null;
}

const styles = createStyles(() => ({
  flex: { flex: 1 },
  frost: { backgroundColor: withAlpha(colors.bg, 0.72) }, // Android: no live blur behind a modal
  veil: { backgroundColor: 'rgba(22,27,29,0.06)' },
  fadeTop: { position: 'absolute', left: 0, right: 0, top: 0 },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingHorizontal: gutter,
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: gutter, gap: space[3] },
  disc: {
    position: 'absolute',
    backgroundColor: 'rgba(22,27,29,0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  innerRing: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  tick: { position: 'absolute', left: 0, backgroundColor: colors.textOnDark },
  tickMajor: { width: 24, height: 2, borderRadius: 1, opacity: 1 },
  tickMid: { width: 17, height: 1.5, borderRadius: 1, opacity: 0.8 },
  tickWhole: { width: 10, height: 1, opacity: 0.5 },
  tickHalf: { width: 6, height: 1, opacity: 0.32 },
  tickDim: { opacity: 0.25 },
  label: { position: 'absolute', left: 34, width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  tenText: { lineHeight: 24, fontVariant: ['tabular-nums'] },
  fiveText: { lineHeight: 18, fontVariant: ['tabular-nums'] },
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
    borderLeftColor: colors.text, // dark in light mode, white in dark mode
  },
  pointerLine: { position: 'absolute', width: 30, height: 3, borderRadius: 2, backgroundColor: colors.lime },
  readout: { position: 'absolute', left: gutter, alignItems: 'flex-end' },
  readoutValue: { fontVariant: ['tabular-nums'] },
  touch: { position: 'absolute', right: 0 },
}));
