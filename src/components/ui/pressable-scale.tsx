import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far to shrink on press. Runs on the UI thread, so it never blocks JS. */
  scaleTo?: number;
};

export function PressableScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.set(withTiming(scaleTo, { duration: 90 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 140 }));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    />
  );
}
