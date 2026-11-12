import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { colors, font, gutter, radius, space } from '@/theme/tokens';

type Slide = { key: string; step: string; title: string; body: string; image: number };

const SLIDES: Slide[] = [
  {
    key: 'find',
    step: 'Find',
    title: 'Your turf\nis waiting.',
    body: 'Floodlit pitches near you, with open slots shown live, so you never call around again.',
    image: require('../../assets/onboarding/1-arrive.webp'),
  },
  {
    key: 'book',
    step: 'Book',
    title: 'Book in\nseconds.',
    body: 'Pick a time, pay with bKash, and walk in with a QR ticket. No cash, no confusion.',
    image: require('../../assets/onboarding/2-play.webp'),
  },
  {
    key: 'squad',
    step: 'Squad up',
    title: 'Short on\nplayers?',
    body: 'Open spots on your booking or join a squad nearby. Everyone pays the same fair share.',
    image: require('../../assets/onboarding/3-squad.webp'),
  },
  {
    key: 'play',
    step: 'Play',
    title: 'Game on.',
    body: 'Your next match starts here. Sign in and grab a slot tonight.',
    image: require('../../assets/onboarding/4-kickoff.webp'),
  },
];

/** One full-screen photo: fades in as its page arrives, with a slow Ken Burns settle. */
function Backdrop({ index, image, x, width }: { index: number; image: number; x: SharedValue<number>; width: number }) {
  const style = useAnimatedStyle(() => {
    const p = x.get() / width;
    return {
      opacity: interpolate(p, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(p, [index - 1, index, index + 1], [1.14, 1.04, 1.1], Extrapolation.CLAMP) },
        { translateX: interpolate(p, [index - 1, index, index + 1], [24, 0, -24], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} priority={index === 0 ? 'high' : 'normal'} />
    </Animated.View>
  );
}

/** A page's words: they drift in from the swipe direction and fade, a beat behind the photo. */
function Copy({ slide, index, x, width }: { slide: Slide; index: number; x: SharedValue<number>; width: number }) {
  const lead = useAnimatedStyle(() => {
    const p = x.get() / width;
    return {
      opacity: interpolate(p, [index - 0.6, index, index + 0.6], [0, 1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(p, [index - 1, index, index + 1], [width * 0.35, 0, -width * 0.35], Extrapolation.CLAMP) }],
    };
  });
  const tail = useAnimatedStyle(() => {
    const p = x.get() / width;
    return {
      opacity: interpolate(p, [index - 0.45, index, index + 0.45], [0, 1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(p, [index - 1, index, index + 1], [width * 0.55, 0, -width * 0.55], Extrapolation.CLAMP) }],
    };
  });
  return (
    <View style={[styles.page, { width }]}>
      <Animated.View style={lead}>
        <View style={styles.stepPill}>
          <Text variant="caption" color={colors.charcoal} style={styles.stepText}>
            {String(index + 1).padStart(2, '0')} · {slide.step.toUpperCase()}
          </Text>
        </View>
        <Text variant="h1" color="#FFFFFF" style={styles.title} maxFontSizeMultiplier={1.15}>
          {slide.title}
        </Text>
      </Animated.View>
      <Animated.View style={tail}>
        <Text variant="body" color="rgba(255,255,255,0.78)" style={styles.body} maxFontSizeMultiplier={1.2}>
          {slide.body}
        </Text>
      </Animated.View>
    </View>
  );
}

function Dot({ index, x, width }: { index: number; x: SharedValue<number>; width: number }) {
  const style = useAnimatedStyle(() => {
    const p = interpolate(x.get() / width, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 8 + p * 22, opacity: 0.4 + p * 0.6, backgroundColor: p > 0.5 ? colors.lime : '#FFFFFF' };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

/** First run: four full-screen photos you swipe through, then straight to sign in. */
export default function Onboarding() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useSession();
  const list = useRef<FlatList<Slide>>(null);
  const [page, setPage] = useState(0);
  const x = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    x.set(e.contentOffset.x);
  });
  const last = page >= SLIDES.length - 1;

  const finish = () => {
    completeOnboarding();
    router.replace('/sign-in');
  };
  const next = () => {
    if (last) return finish();
    list.current?.scrollToIndex({ index: page + 1 });
    setPage(page + 1);
  };

  return (
    <View style={styles.root}>
      {SLIDES.map((s, i) => (
        <Backdrop key={s.key} index={i} image={s.image} x={x} width={width} />
      ))}
      {/* Keeps the words readable on any photo: clear at the top, near-black at the bottom. */}
      <LinearGradient
        colors={['rgba(4,7,5,0.55)', 'rgba(4,7,5,0)', 'rgba(4,7,5,0.35)', 'rgba(4,7,5,0.92)', '#040705']}
        locations={[0, 0.18, 0.45, 0.72, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.View entering={FadeIn.duration(500)} style={[styles.header, { paddingTop: insets.top + space[2] }]}>
        <Wordmark height={26} tone="light" />
        {!last ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Skip intro" hitSlop={12} onPress={finish} style={styles.skip}>
            <Text variant="labelStrong" color="#FFFFFF">
              Skip
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>

      <View style={styles.bottom}>
        <Animated.View entering={FadeInDown.duration(600).delay(150)} style={styles.copyArea}>
          <Animated.FlatList
            ref={list as never}
            data={SLIDES}
            keyExtractor={(s) => s.key}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            renderItem={({ item, index }) => <Copy slide={item} index={index} x={x} width={width} />}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(600).delay(300)} style={[styles.footer, { paddingBottom: insets.bottom + space[4] }]}>
          <View style={styles.dots} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: SLIDES.length, now: page + 1 }}>
            {SLIDES.map((s, i) => (
              <Dot key={s.key} index={i} x={x} width={width} />
            ))}
          </View>
          <Button label={last ? 'Get started' : 'Next'} variant="primary" trailingIcon={ArrowRight} spread onPress={next} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#040705' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter },
  skip: { paddingHorizontal: space[3], height: 34, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.16)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  copyArea: { height: 250 },
  page: { paddingHorizontal: gutter, justifyContent: 'flex-end', paddingBottom: space[4], gap: space[3] },
  stepPill: { alignSelf: 'flex-start', backgroundColor: colors.lime, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: 5, marginBottom: space[3] },
  stepText: { fontFamily: font.semibold, letterSpacing: 1.2 },
  title: { fontFamily: font.bold, fontSize: 44, lineHeight: 47, letterSpacing: -1.4 },
  body: { fontSize: 17, lineHeight: 25, maxWidth: 360 },
  footer: { paddingHorizontal: gutter, gap: space[5] },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 8, borderRadius: 4 },
});
