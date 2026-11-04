import { useEffect } from 'react';
import { type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radius } from '@/theme/tokens';

/** Shimmer-free pulse skeleton (cheap: one opacity animation on the UI thread). */
export function Skeleton({
  width = '100%',
  height = 16,
  r = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const o = useSharedValue(0.55);
  useEffect(() => {
    o.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.surfaceMuted }, a, style]} />;
}
