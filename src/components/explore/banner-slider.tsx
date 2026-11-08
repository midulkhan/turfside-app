import { useIsFocused } from 'expo-router';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/** Bundled, pre-sized (1080 px wide WebP, 40–70 KB each): no network, nothing to wait for. */
const SLIDES = [
  { src: require('@/assets/banners/banner-1.webp'), label: 'Find your play. Your next game starts here. Discover turfs near you.' },
  { src: require('@/assets/banners/banner-2.webp'), label: 'Start with a match. A fresh day. A new game. Explore turfs around you.' },
  {
    src: require('@/assets/banners/banner-3.webp'),
    label: 'Better together. Bring your squad. Own the pitch. Find a turf for your next match.',
  },
  {
    src: require('@/assets/banners/banner-4.webp'),
    label: 'Your game, your time. Less planning. More playing. Discover your next pitch nearby.',
  },
  {
    src: require('@/assets/banners/banner-5.webp'),
    label: 'Under the lights. Make tonight a match night. Find your perfect evening slot.',
  },
];
const ASPECT = 1080 / 400;
const AUTOPLAY_MS = 4500;

/**
 * Promo slider on Explore: one rounded banner per page, swipe or autoplay, dots below.
 *  - The dots follow the finger on the UI thread (no React re-render while swiping).
 *  - Only the first banner decodes with the page; the rest a moment later.
 *  - Autoplay pauses while touched, when Explore isn't on screen, and in the background.
 *  - Endless: after the last banner comes a copy of the first, then a silent jump back.
 */
export const BannerSlider = memo(function BannerSlider() {
  const { width } = useWindowDimensions();
  const cardW = width - gutter * 2;
  const cardH = Math.round(cardW / ASPECT);
  const ref = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const page = useRef(0);
  const touching = useRef(false);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [rest, setRest] = useState(false); // banners 2+ mount after the first frame

  useEffect(() => {
    const t = setTimeout(() => setRest(true), 400);
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, []);

  const onScroll = useAnimatedScrollHandler((e) => {
    x.set(e.contentOffset.x);
  });

  // Landed on the copy of banner 1: jump to the real one (same picture, so nothing moves).
  const settle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const p = Math.round(e.nativeEvent.contentOffset.x / width);
      if (p >= SLIDES.length) {
        ref.current?.scrollTo({ x: 0, animated: false });
        page.current = 0;
      } else page.current = p;
    },
    [ref, width],
  );

  useEffect(() => {
    if (!focused || !active || !rest) return;
    const t = setInterval(() => {
      if (touching.current) return;
      ref.current?.scrollTo({ x: (page.current + 1) * width, animated: true });
    }, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [focused, active, rest, ref, width]);

  const pages = rest ? [...SLIDES, SLIDES[0]] : SLIDES.slice(0, 1);

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => (touching.current = true)}
        onScrollEndDrag={() => (touching.current = false)}
        onMomentumScrollEnd={settle}
        accessibilityRole="adjustable"
        accessibilityLabel="Highlights">
        {pages.map((s, i) => (
          <View key={i} style={{ width, paddingHorizontal: gutter }} accessible accessibilityLabel={s.label} accessibilityRole="image">
            <Image
              source={s.src}
              style={[styles.card, { width: cardW, height: cardH }]}
              contentFit="cover"
              priority={i === 0 ? 'high' : 'low'}
              cachePolicy="memory"
              transition={0}
              accessibilityIgnoresInvertColors
            />
          </View>
        ))}
      </Animated.ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {SLIDES.map((_, i) => (
          <Dot key={i} i={i} x={x} width={width} />
        ))}
      </View>
    </View>
  );
});

function Dot({ i, x, width }: { i: number; x: SharedValue<number>; width: number }) {
  const n = SLIDES.length;
  const style = useAnimatedStyle(() => {
    // Position in pages; the copy of banner 1 (index n) counts as banner 1.
    const p = x.get() / width;
    const pos = p > n - 1 ? (p - (n - 1)) * -(n - 1) + (n - 1) : p; // last → first glides back
    const d = Math.min(Math.abs(pos - i), 1);
    return { width: interpolate(d, [0, 1], [18, 6]), opacity: interpolate(d, [0, 1], [1, 0.35]) };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = createStyles(() => ({
  root: { gap: space[3] },
  card: { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { height: 6, borderRadius: 3, backgroundColor: colors.ink },
}));
