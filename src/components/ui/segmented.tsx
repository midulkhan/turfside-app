import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { haptic } from '@/lib/haptics';
import { createStyles } from '@/theme/styles';
import { colors, radius } from '@/theme/tokens';

/** Small pill segmented control; the highlight slides on the UI thread. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  large,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
  /** Page-level tabs (44 tall, larger text) instead of the compact settings switch. */
  large?: boolean;
}) {
  const [w, setW] = useState(0);
  const seg = w / options.length;
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useSharedValue(0);
  useEffect(() => {
    x.set(withTiming(i * seg, { duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
  }, [i, seg, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View
      style={[styles.wrap, large && styles.wrapLarge]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setW(e.nativeEvent.layout.width - 4)}>
      {w ? <Animated.View style={[styles.thumb, { width: seg }, thumb]} /> : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              haptic.select();
              onChange(o.value);
            }}
            style={styles.seg}>
            <Text variant={large ? 'label' : 'caption'} color={on ? colors.text : colors.textMuted} style={on ? styles.on : undefined}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createStyles(() => ({
  wrap: { flexDirection: 'row', padding: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, height: 32 },
  wrapLarge: { height: 44 },
  thumb: {
    position: 'absolute',
    left: 2,
    top: 2,
    bottom: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  seg: { flex: 1, minWidth: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  on: { fontFamily: 'Geist_600SemiBold' },
}));
