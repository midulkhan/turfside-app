import { CalendarDays, Heart, House, UserRound, type LucideIcon } from 'lucide-react-native';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { Text } from '@/components/ui/text';
import { haptic } from '@/lib/haptics';
import { colors, radius, shadow, size, space } from '@/theme/tokens';

const TABS: Record<string, { icon: LucideIcon; label: string }> = {
  explore: { icon: House, label: 'Explore' },
  bookings: { icon: CalendarDays, label: 'Bookings' },
  saved: { icon: Heart, label: 'Saved' },
  profile: { icon: UserRound, label: 'Profile' },
};

const PAD = 8; // inner padding of the bar
const INDICATOR_SPRING = { damping: 22, stiffness: 260, mass: 0.8 };

/** Space screens must leave at the bottom so content clears the floating bar. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return size.tabBar + Math.max(insets.bottom, space[3]) + space[5];
}

/**
 * One tab: fixed slot, icon above label — never changes size or position.
 * It draws a light and a dark version of its content; the dark one fades in as
 * the sliding pill arrives, so the colour change tracks the pill frame by frame.
 */
const TabItem = memo(function TabItem({
  name,
  index,
  focused,
  position,
  onPress,
  onLongPress,
}: {
  name: string;
  index: number;
  focused: boolean;
  position: SharedValue<number>;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const meta = TABS[name];
  const Icon = meta.icon;
  const onPill = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(position.get() - index), [0, 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  const offPill = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(position.get() - index), [0, 0.6], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}>
      <Animated.View style={[styles.content, offPill]}>
        <Icon size={24} color={colors.textOnDark} strokeWidth={1.8} />
        <Text variant="caption" color={colors.textOnDarkMuted} numberOfLines={1}>
          {meta.label}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.content, styles.overlay, onPill]}>
        <Icon size={24} color={colors.ink} strokeWidth={2.3} />
        <Text variant="caption" color={colors.ink} numberOfLines={1} style={styles.labelActive}>
          {meta.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

/**
 * Floating charcoal tab bar.
 * - Four equal, fixed slots: tabs never move or resize when you switch.
 * - A single lime pill slides behind the active tab on the UI thread (no JS work per frame).
 * - Tapping the active tab again scrolls that screen to the top.
 */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const activeIndex = Math.max(
    0,
    routes.findIndex((r) => r.key === state.routes[state.index]?.key),
  );

  const slot = useSharedValue(0); // width of one slot, measured once
  const position = useSharedValue(activeIndex);

  useEffect(() => {
    position.set(withSpring(activeIndex, INDICATOR_SPRING));
  }, [activeIndex, position]);

  const onLayout = (e: LayoutChangeEvent) => {
    slot.set((e.nativeEvent.layout.width - PAD * 2) / routes.length);
  };

  const indicator = useAnimatedStyle(() => ({
    width: slot.get(),
    opacity: slot.get() > 0 ? 1 : 0,
    transform: [{ translateX: position.get() * slot.get() }],
  }));

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, space[3]) }]}>
      <View style={[styles.bar, shadow.float]} onLayout={onLayout} accessibilityRole="tablist">
        <Animated.View pointerEvents="none" style={[styles.indicator, indicator]}>
          <View style={styles.pill} />
        </Animated.View>
        {routes.map((route, i) => {
          const focused = i === activeIndex;
          return (
            <TabItem
              key={route.key}
              name={route.name}
              index={i}
              focused={focused}
              position={position}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  haptic.select();
                  navigateToTab(route.key);
                }
              }}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4] },
  bar: {
    height: size.tabBar,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
  },
  indicator: { position: 'absolute', left: PAD, top: PAD, bottom: PAD, paddingHorizontal: 2, zIndex: 0 },
  pill: { flex: 1, borderRadius: radius.pill, backgroundColor: colors.lime },
  item: { flex: 1, height: '100%', zIndex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  overlay: { ...StyleSheet.absoluteFill },
  labelActive: { fontFamily: 'Geist_700Bold' },
});
