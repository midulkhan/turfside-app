import { CalendarDays, Heart, House, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react-native';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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
import { useCart } from '@/features/api/use-cart';
import { haptic } from '@/lib/haptics';
import { colors, radius, shadow, size, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const TABS: Record<string, { icon: LucideIcon; label: string }> = {
  explore: { icon: House, label: 'Explore' },
  bookings: { icon: CalendarDays, label: 'Bookings' },
  cart: { icon: ShoppingBag, label: 'Cart' },
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
 * It draws a muted and a lime version of its content and cross-fades between
 * them as the selection moves.
 */
const TabItem = memo(function TabItem({
  name,
  index,
  focused,
  position,
  count,
  onPress,
  onLongPress,
}: {
  name: string;
  index: number;
  focused: boolean;
  count?: number;
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
      accessibilityLabel={count ? `${meta.label}, ${count}` : meta.label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}>
      <Animated.View style={[styles.content, offPill]}>
        <Icon size={20} color={colors.textOnDarkMuted} strokeWidth={1.6} />
        <Text variant="caption" color={colors.textOnDarkMuted} numberOfLines={1} style={styles.label}>
          {meta.label}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.content, styles.overlay, onPill]}>
        <Icon size={20} color={colors.lime} strokeWidth={2} />
        <Text variant="caption" color={colors.lime} numberOfLines={1} style={[styles.label, styles.labelActive]}>
          {meta.label}
        </Text>
      </Animated.View>
      {count ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text variant="caption" color={colors.charcoal} style={styles.badgeText}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * Floating charcoal tab bar.
 * - Equal, fixed slots: tabs never move or resize when you switch.
 * - The active tab's icon and label turn lime (a quick cross-fade on the UI thread).
 * - Tapping the active tab again scrolls that screen to the top.
 */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const activeIndex = Math.max(
    0,
    routes.findIndex((r) => r.key === state.routes[state.index]?.key),
  );

  const position = useSharedValue(activeIndex);

  useEffect(() => {
    position.set(withSpring(activeIndex, INDICATOR_SPRING));
  }, [activeIndex, position]);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, space[3]) }]}>
      <View style={[styles.bar, shadow.float]} accessibilityRole="tablist">
        {routes.map((route, i) => {
          const focused = i === activeIndex;
          return (
            <TabItem
              key={route.key}
              name={route.name}
              index={i}
              focused={focused}
              position={position}
              count={route.name === 'cart' ? cart.count : undefined}
              onPress={() => {
                // Cart: with a slot held, go straight to its checkout instead of the tab.
                if (route.name === 'cart' && cart.open()) {
                  haptic.select();
                  return;
                }
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

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: space[4], right: space[4] },
  bar: {
    height: size.tabBar,
    borderRadius: radius.pill,
    backgroundColor: colors.inverse,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
  },
  item: { flex: 1, height: '100%', zIndex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11, lineHeight: 14 },
  overlay: { ...StyleSheet.absoluteFill },
  labelActive: { fontFamily: 'Geist_600SemiBold' },
  badge: {
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.inverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontFamily: 'Geist_700Bold' },
}));
