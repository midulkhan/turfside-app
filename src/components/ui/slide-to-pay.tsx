import { ArrowRight, Check, ChevronsRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, motion, radius, space } from '@/theme/tokens';

import { Text } from './text';

const H = 64;
const KNOB = H - 12;

/**
 * Slide-to-pay. A deliberate gesture prevents accidental payments.
 * The gesture runs entirely on the UI thread; only the final "complete"
 * crosses to JS. `busy` keeps it locked while the server confirms payment.
 */
export function SlideToPay({
  label,
  onComplete,
  busy,
  disabled,
}: {
  label: string;
  onComplete: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const x = useSharedValue(0);
  const max = useSharedValue(0);
  const [done, setDone] = useState(false);
  const [prevBusy, setPrevBusy] = useState(busy);

  // Payment failed or was cancelled (busy went true → false) → let the user try again.
  if (busy !== prevBusy) {
    setPrevBusy(busy);
    if (!busy && done) setDone(false);
  }
  useEffect(() => {
    if (!busy && !done) x.set(withSpring(0, motion.spring));
  }, [busy, done, x]);

  const complete = () => {
    setDone(true);
    haptic.success();
    onComplete();
  };

  const pan = usePanGesture({
    enabled: !disabled && !busy && !done,
    activeOffsetX: [-6, 6],
    onUpdate: (e) => {
      'worklet';
      x.set(Math.min(Math.max(0, e.translationX), max.get()));
    },
    onDeactivate: () => {
      'worklet';
      if (x.get() > max.get() * 0.82) {
        x.set(withTiming(max.get(), { duration: 120 }));
        scheduleOnRN(complete);
      } else {
        x.set(withSpring(0, motion.spring));
      }
    },
  });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  // Track glow around the knob: 6pt on every side (was flush on the right).
  const fill = useAnimatedStyle(() => ({ width: x.get() + KNOB + 12 }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [0, Math.max(1, max.get() * 0.6)], [1, 0], Extrapolation.CLAMP),
  }));

  // Looping hint: the chevrons glide right and fade, nudging the user to slide.
  const hint = useSharedValue(0);
  useEffect(() => {
    hint.set(withRepeat(withTiming(1, { duration: 1150, easing: Easing.out(Easing.quad) }), -1, false));
  }, [hint]);
  const hintStyle = useAnimatedStyle(() => {
    const dragFade = interpolate(x.get(), [0, Math.max(1, max.get() * 0.4)], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: interpolate(hint.get(), [0, 0.25, 0.75, 1], [0, 1, 1, 0]) * dragFade,
      transform: [{ translateX: interpolate(hint.get(), [0, 1], [-10, 8]) }],
    };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    max.set(e.nativeEvent.layout.width - KNOB - 12);
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={[styles.track, (disabled || busy) && !done ? styles.dim : null]}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Slide right to pay"
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={() => !disabled && !busy && !done && complete()}>
        <Animated.View style={[styles.fill, fill]} />
        <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
          <Text variant="bodyStrong" color={colors.textOnDark} style={styles.label}>
            {label}
          </Text>
        </Animated.View>
        <Animated.View style={[styles.chevrons, hintStyle]} pointerEvents="none">
          <ChevronsRight size={26} color={colors.lime} strokeWidth={2.4} />
        </Animated.View>
        <Animated.View style={[styles.knob, knob]}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : done ? (
            <Check size={24} color={colors.ink} strokeWidth={3} />
          ) : (
            <ArrowRight size={24} color={colors.ink} strokeWidth={2.6} />
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: { height: H, borderRadius: radius.pill, backgroundColor: colors.ink, justifyContent: 'center', overflow: 'hidden' },
  dim: { opacity: 0.6 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(221,248,92,0.16)', borderRadius: radius.pill },
  labelWrap: { position: 'absolute', left: KNOB + 18, right: 52, alignItems: 'center' },
  label: { fontSize: 17 },
  chevrons: { position: 'absolute', right: space[5] },
  knob: {
    position: 'absolute',
    left: 6,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
