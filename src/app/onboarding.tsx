import { router } from 'expo-router';
import { ArrowRight, ArrowUpRight, CircleCheck, Clock3, MapPin, QrCode } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Photo } from '@/components/ui/photo';
import { Text } from '@/components/ui/text';
import { TicketDivider, TicketSurface } from '@/components/ticket/notch';
import { photos } from '@/features/api/mock-db';
import { useSession } from '@/features/session/session';
import { colors, gutter, radius, shadow, space } from '@/theme/tokens';

type Slide = {
  key: string;
  step: string;
  title: string;
  body: string;
  photo: ImageSourcePropType;
  overlay: 'place' | 'ticket' | 'players';
};

const SLIDES: Slide[] = [
  {
    key: 'discover',
    step: '01 / Discover',
    title: 'Your next game.\nCloser than ever.',
    body: 'Discover great turfs nearby.\nFind your place to play.',
    photo: photos.evening,
    overlay: 'place',
  },
  {
    key: 'book',
    step: '02 / Book',
    title: 'Pick a slot.\nMake it yours.',
    body: 'Choose your time, pay securely,\nand keep your ticket handy.',
    photo: photos.dusk,
    overlay: 'ticket',
  },
  {
    key: 'play',
    step: '03 / Play',
    title: 'More players.\nBetter games.',
    body: 'Find teammates nearby\nor bring your own squad.',
    photo: photos.players,
    overlay: 'players',
  },
];

function Overlay({ kind }: { kind: Slide['overlay'] }) {
  if (kind === 'place')
    return (
      <View style={[styles.placeChip, shadow.card]}>
        <MapPin size={18} color={colors.ink} strokeWidth={2.2} />
        <Text variant="labelStrong">Bashundhara Arena</Text>
        <View style={styles.vr} />
        <Text variant="label" color={colors.textMuted}>
          1.2 km away
        </Text>
      </View>
    );
  if (kind === 'players')
    return (
      <View style={[styles.playersCard, shadow.card]}>
        <View style={styles.rowCenter}>
          <View style={styles.liveDot} />
          <Text variant="labelStrong">2 players needed</Text>
        </View>
        <AvatarStack names={['Rafi Ahmed', 'Sami Khan']} size={32} />
      </View>
    );
  return null;
}

function TicketHero() {
  return (
    <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.xl} notch={11} style={styles.ticket}>
      <Photo source={photos.dusk} style={styles.ticketPhoto} />
      <View style={styles.ticketBody}>
        <Text variant="h3" style={styles.italic}>
          Bashundhara Arena
        </Text>
        <View style={styles.rowCenter}>
          <Clock3 size={16} color={colors.ink} strokeWidth={2} />
          <Text variant="label">7:00–8:30 PM</Text>
        </View>
        <View style={styles.confirmed}>
          <CircleCheck size={16} color={colors.ink} strokeWidth={2.2} />
          <Text variant="labelStrong">Booking confirmed</Text>
        </View>
      </View>
      <TicketDivider gap={8} />
      <View style={styles.ticketPass}>
        <QrCode size={26} color={colors.textOnDark} strokeWidth={1.8} />
        <View style={styles.vrDark} />
        <Text variant="labelStrong" color={colors.textOnDark} style={styles.italic}>
          Your entry pass
        </Text>
      </View>
    </TicketSurface>
  );
}

function Dot({ index, x, width }: { index: number; x: SharedValue<number>; width: number }) {
  const style = useAnimatedStyle(() => {
    const p = interpolate(x.value / width, [index - 1, index, index + 1], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 10 + p * 26, backgroundColor: p > 0.5 ? colors.lime : colors.borderStrong };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export default function Onboarding() {
  const { width, height } = useWindowDimensions();
  const { completeOnboarding } = useSession();
  const list = useRef<FlatList<Slide>>(null);
  const [page, setPage] = useState(0);
  const x = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    x.set(e.contentOffset.x);
  });
  const heroH = Math.min(height * 0.44, 420);

  const finish = (to: '/sign-up' | '/owner-sign-up' = '/sign-up') => {
    completeOnboarding();
    router.replace(to);
  };
  const next = () => {
    if (page >= SLIDES.length - 1) return finish();
    list.current?.scrollToIndex({ index: page + 1 });
    setPage(page + 1);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Wordmark height={30} />
        <Pressable accessibilityRole="button" hitSlop={12} onPress={() => finish()}>
          <Text variant="bodyStrong">Skip</Text>
        </Pressable>
      </View>

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
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={[styles.hero, { height: heroH }]}>
              <View style={styles.blob} />
              {item.overlay === 'ticket' ? (
                <TicketHero />
              ) : (
                <View style={styles.photoWrap}>
                  <Photo source={item.photo} style={styles.photo} rounded={radius.xl + 12} />
                  <View style={styles.overlayPos}>
                    <Overlay kind={item.overlay} />
                  </View>
                </View>
              )}
            </View>
            <View style={styles.copy}>
              <Text variant="overline" color={colors.textMuted}>
                {item.step.toUpperCase()}
              </Text>
              <Text variant="h1" style={styles.title}>
                {item.title}
              </Text>
              <Text variant="body" color={colors.textMuted} style={styles.body}>
                {item.body}
              </Text>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.key} index={i} x={x} width={width} />
          ))}
        </View>
        <Button
          label={page === SLIDES.length - 1 ? 'Get started' : 'Next'}
          variant="dark"
          trailingIcon={ArrowRight}
          spread
          onPress={next}
        />
        <Pressable
          accessibilityRole="link"
          onPress={() => finish('/owner-sign-up')}
          style={[styles.owner, page !== SLIDES.length - 1 && styles.hidden]}
          disabled={page !== SLIDES.length - 1}>
          <Text variant="labelStrong" style={styles.underline}>
            Own a turf? List your venue
          </Text>
          <ArrowUpRight size={16} color={colors.ink} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: gutter,
    paddingVertical: space[3],
  },
  slide: { paddingHorizontal: gutter, gap: space[6] },
  hero: { justifyContent: 'center', alignItems: 'center', marginTop: space[2] },
  blob: {
    position: 'absolute',
    top: -10,
    left: -20,
    width: 220,
    height: 160,
    borderRadius: 120,
    backgroundColor: colors.limeTint,
    opacity: 0.7,
    transform: [{ rotate: '-18deg' }],
  },
  photoWrap: { width: '100%', height: '100%' },
  photo: { width: '100%', height: '100%' },
  overlayPos: { position: 'absolute', left: space[4], right: space[4], bottom: space[5], alignItems: 'flex-start' },
  placeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    height: 48,
  },
  vr: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: space[1] },
  vrDark: { width: 1, height: 24, backgroundColor: colors.borderOnDark },
  playersCard: { alignSelf: 'flex-end', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#A8D52B' },
  ticket: { width: '82%', transform: [{ rotate: '-4deg' }] },
  ticketPhoto: { height: 150, margin: space[2] },
  ticketBody: { paddingHorizontal: space[4], gap: space[2], paddingBottom: space[2] },
  italic: { fontFamily: 'Geist_800ExtraBold_Italic' },
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    height: 32,
  },
  ticketPass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.ink,
    margin: space[2],
    marginTop: space[3],
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    height: 60,
  },
  copy: { gap: space[3] },
  title: { fontSize: 30, lineHeight: 35 },
  body: { fontSize: 17, lineHeight: 24 },
  footer: { paddingHorizontal: gutter, paddingBottom: space[3], gap: space[5] },
  dots: { flexDirection: 'row', gap: space[2], justifyContent: 'center' },
  dot: { height: 10, borderRadius: 5 },
  owner: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 4, minHeight: 32 },
  hidden: { opacity: 0 },
  underline: { textDecorationLine: 'underline' },
});
