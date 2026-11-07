import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme/tokens';

/**
 * Tracks whether a scroller has left the top. Pass `onScroll` to any
 * ScrollView / FlashList; `progress` eases 0 → 1 on the UI thread.
 * JS only runs when the threshold is crossed, so scrolling stays smooth.
 */
export function useScrolled(threshold = 6) {
  const progress = useSharedValue(0);
  const past = useRef(false);
  const [isScrolled, setIsScrolled] = useState(false); // for things that can't animate (e.g. swapping a variant)
  /** Set "scrolled past the threshold" directly (for screens that track scroll on the UI thread). */
  const setPast = useCallback(
    (now: boolean) => {
      if (now === past.current) return;
      past.current = now;
      setIsScrolled(now);
      progress.set(withTiming(now ? 1 : 0, { duration: 180 }));
    },
    [progress],
  );
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPast(e.nativeEvent.contentOffset.y > threshold),
    [setPast, threshold],
  );
  return { progress, onScroll, isScrolled, setPast };
}

/**
 * Header that stays put while the content scrolls: page-coloured at the top,
 * white with a hairline once the user scrolls. It also covers the status bar
 * area (pass `safeTop={false}` if the screen already pads for it).
 */
export function StickyHeader({
  progress,
  children,
  style,
  safeTop = true,
  from = colors.bg,
  floating,
}: {
  progress: SharedValue<number>;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  safeTop?: boolean;
  /** Background at rest (default: the page colour). */
  from?: string;
  /** Overlay the content (e.g. over a photo) instead of sitting above it. */
  floating?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const anim = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [from, colors.surface]),
    borderBottomColor: interpolateColor(progress.get(), [0, 1], ['rgba(229,231,224,0)', colors.border]),
  }));
  return (
    <Animated.View style={[styles.base, floating && styles.floating, { paddingTop: safeTop ? insets.top : 0 }, anim]}>
      {/* `style` goes on an inner view so a screen's own padding can never cancel the status-bar inset. */}
      <View style={style}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 10 },
  floating: { position: 'absolute', left: 0, right: 0, top: 0 },
});
