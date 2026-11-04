import { BlurView } from 'expo-blur';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme/tokens';

import { Button } from './button';
import { IconButton } from './icon-button';
import { Text } from './text';

/**
 * Distance picker: a full-screen frosted overlay with a vertical wheel
 * (5–50 km in 5 km steps). Values curve away from the centre like a drum,
 * each step ticks a light haptic, and Apply sets the search radius.
 */
export const DISTANCES = Array.from({ length: 10 }, (_, i) => (i + 1) * 5);
export const DEFAULT_DISTANCE = 5;
const ROW = 68;
const VISIBLE = 5; // rows on screen; the middle one is the pick

function WheelRow({ km, index, y }: { km: number; index: number; y: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const d = index - y.get() / ROW; // rows away from the centre
    return {
      opacity: interpolate(Math.abs(d), [0, 1, 2, 3], [1, 0.55, 0.22, 0], Extrapolation.CLAMP),
      transform: [
        { perspective: 600 },
        { rotateX: `${interpolate(d, [-3, 0, 3], [62, 0, -62], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(Math.abs(d), [0, 1, 2], [1, 0.82, 0.7], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[styles.row, style]}>
      <Text variant="display" style={styles.rowText}>
        {km}
      </Text>
    </Animated.View>
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
  const start = Math.max(0, DISTANCES.indexOf(value));
  const y = useSharedValue(start * ROW);
  const last = useSharedValue(start);
  const [pick, setPick] = useState(value);
  const ref = useRef<Animated.ScrollView>(null);
  // contentOffset isn't honoured everywhere (Android, web), so jump to the
  // current value right after the wheel mounts.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => ref.current?.scrollTo({ y: start * ROW, animated: false }), 60);
    return () => clearTimeout(t);
  }, [visible, start]);

  // Reset to the current value every time the picker opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPick(value);
      y.set(start * ROW);
      last.set(start);
    }
  }

  const tick = (i: number) => {
    haptic.select();
    setPick(DISTANCES[i]);
  };
  const onScroll = useAnimatedScrollHandler((e) => {
    y.set(e.contentOffset.y);
    const i = Math.min(DISTANCES.length - 1, Math.max(0, Math.round(e.contentOffset.y / ROW)));
    if (i !== last.get()) {
      last.set(i);
      scheduleOnRN(tick, i);
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint="systemThinMaterialLight" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.frost]} />
      )}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

      <View style={[styles.sheet, { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[5] }]} pointerEvents="box-none">
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text variant="overline" color={colors.textMuted}>
              Distance
            </Text>
            <Text variant="h2">How far will you go?</Text>
          </View>
          <IconButton icon={X} label="Close" onPress={onClose} />
        </View>

        <Animated.View entering={FadeIn.duration(220)} style={styles.wheelWrap}>
          {/* centre band: the value in it is the pick */}
          <View style={styles.band} pointerEvents="none">
            <Text variant="h3" color={colors.ink} style={styles.unit}>
              km
            </Text>
          </View>
          <Animated.ScrollView
            ref={ref}
            style={styles.wheel}
            contentContainerStyle={{ paddingVertical: ROW * Math.floor(VISIBLE / 2) }}
            contentOffset={{ x: 0, y: start * ROW }}
            snapToInterval={ROW}
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            accessibilityRole="adjustable"
            accessibilityLabel="Distance"
            accessibilityValue={{ text: `${pick} kilometres` }}>
            {DISTANCES.map((km, i) => (
              <WheelRow key={km} km={km} index={i} y={y} />
            ))}
          </Animated.ScrollView>
        </Animated.View>

        <View style={styles.bottom}>
          <Text variant="body" color={colors.textMuted} align="center">
            Show turfs within <Text variant="bodyStrong">{pick} km</Text> of you
          </Text>
          <Button
            label={`Apply · ${pick} km`}
            onPress={() => {
              haptic.success();
              onApply(pick);
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frost: { backgroundColor: 'rgba(244,245,240,0.94)' },
  sheet: { flex: 1, paddingHorizontal: gutter, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  flex: { flex: 1, gap: space[1] },
  wheelWrap: { height: ROW * VISIBLE, justifyContent: 'center' },
  wheel: { height: ROW * VISIBLE },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: space[6],
  },
  unit: { fontFamily: 'Geist_700Bold' },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  rowText: { fontVariant: ['tabular-nums'], fontSize: 44, lineHeight: 52 },
  bottom: { gap: space[4] },
});
