import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { createStyles } from '@/theme/styles';
import { colors } from '@/theme/tokens';

const W = 51;
const H = 31;
const KNOB = 27;
const PAD = 2;
const SPRING = { damping: 20, stiffness: 320, mass: 0.7 };

/**
 * On/off switch, drawn by us on both platforms in the iOS shape (51×31 pill, 27pt knob with
 * a soft shadow, spring slide, knob stretches while pressed). Not the native UISwitch: on the
 * current iOS design it draws larger than the box React Native lays out, so it sat off-centre.
 */
export function Switch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return <AppleSwitch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} />;
}

function AppleSwitch({ value, onValueChange, disabled, accessibilityLabel }: Parameters<typeof Switch>[0]) {
  const on = useSharedValue(value ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    on.set(withSpring(value ? 1 : 0, SPRING));
  }, [value, on]);
  const offTrack = colors.surfaceMuted;
  const onTrack = colors.limeText;
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.get(), [0, 1], [offTrack, onTrack]) }));
  const knob = useAnimatedStyle(() => {
    const stretch = press.get() * 6; // iOS widens the knob while your finger is down
    const x = PAD + on.get() * (W - KNOB - PAD * 2 - stretch);
    return { width: KNOB + stretch, transform: [{ translateX: x }] };
  });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      onPressIn={() => press.set(withTiming(1, { duration: 120 }))}
      onPressOut={() => press.set(withTiming(0, { duration: 160 }))}
      onPress={() => {
        haptic.select();
        onValueChange(!value);
      }}>
      <Animated.View style={[styles.track, disabled && styles.disabled, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = createStyles(() => ({
  track: { width: W, height: H, borderRadius: H / 2, justifyContent: 'center' },
  knob: {
    position: 'absolute',
    left: 0,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  disabled: { opacity: 0.45 },
}));
