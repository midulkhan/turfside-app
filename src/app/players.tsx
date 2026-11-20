import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowLeft, Bell, CalendarDays, Info, MapPin, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateMatchSheet, MatchCard, whenLabel } from '@/components/match/match-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Photo } from '@/components/ui/photo';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useMyMatches } from '@/features/api/queries';
import { useLiveMatchFeed } from '@/features/api/realtime';
import type { MyMatches } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, font, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

type Booking = MyMatches['bookings'][number];

/**
 * Find players (organiser): the games you've opened spots on, and your upcoming paid bookings
 * that could still take players. Joining someone else's game is on Join a squad.
 */
export default function FindPlayers() {
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  const q = useMyMatches();
  const pull = usePullToRefresh(q.refetch);
  const [opening, setOpening] = useState<Booking | null>(null);
  useLiveMatchFeed(); // requests and payments on your games show up as they happen

  const matches = q.data?.matches ?? [];
  const bookings = q.data?.bookings ?? [];
  const waiting = matches.reduce((n, m) => n + m.openSpots, 0);

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <View style={styles.titleBlock}>
            <Text variant="title" numberOfLines={1}>
              Find players
            </Text>
            <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
              For your bookings
            </Text>
          </View>
          <IconButton icon={Bell} label="Notifications" onPress={() => router.push('/notifications')} />
        </View>
      </StickyHeader>

      {q.isError && !q.data ? (
        <ErrorState message={q.error.message} onRetry={q.refetch} />
      ) : (
        <ScrollView
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.banner}>
            <Image source={require('@/assets/banners/players-bg.webp')} style={styles.bannerImg} contentFit="cover" contentPosition="right center" transition={0} />
            <View style={styles.bannerText}>
              <Text variant="h1" color="#FFFFFF" style={styles.bannerTitle} maxFontSizeMultiplier={1.1}>
                {waiting > 0 ? `${waiting} spot${waiting === 1 ? '' : 's'} to fill.` : 'Short of players?'}
              </Text>
              <Text variant="label" color="rgba(255,255,255,0.8)" style={styles.bannerSub}>
                Open spots, or find a team to play. You choose who joins.
              </Text>
            </View>
          </View>

          {q.isPending ? (
            <>
              <Skeleton height={22} width="40%" />
              <Skeleton height={250} r={radius.xl} />
            </>
          ) : !matches.length && !bookings.length ? (
            <View style={styles.empty}>
              <EmptyState
                icon={UsersRound}
                title="No upcoming bookings"
                body="Book a turf first. Then open the spots you can't fill, or find a team to play against."
                action="Book a turf"
                onAction={() => router.dismissTo('/explore')}
              />
            </View>
          ) : (
            <>
              {matches.length ? (
                <View style={styles.section}>
                  <SectionRow title="Your games" count={matches.length} unit="game" />
                  {matches.map((m) => (
                    <MatchCard key={m.id} m={m} />
                  ))}
                </View>
              ) : null}

              {bookings.length ? (
                <View style={styles.section}>
                  <SectionRow title="Post a booking" count={bookings.length} unit="booking" />
                  {bookings.map((b) => (
                    <BookingRow key={b.id} b={b} onOpen={() => setOpening(b)} />
                  ))}
                </View>
              ) : null}

              <View style={styles.note}>
                <Info size={16} color={colors.textMuted} strokeWidth={1.8} />
                <Text variant="label" color={colors.textMuted} style={styles.flex}>
                  Players pay the same fair share; an opponent team pays the part you choose. Whoever you accept has 5 minutes to pay.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      )}

      <CreateMatchSheet booking={opening} onClose={() => setOpening(null)} />
    </View>
  );
}

function SectionRow({ title, count, unit }: { title: string; count: number; unit: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text variant="title" style={styles.sectionTitle}>
        {title}
      </Text>
      <Text variant="label" color={colors.textMuted}>
        {count} {count === 1 ? unit : `${unit}s`}
      </Text>
    </View>
  );
}

function BookingRow({ b, onOpen }: { b: Booking; onOpen: () => void }) {
  return (
    <Card style={styles.booking} padded={false}>
      <View style={styles.bookingTop}>
        <Photo source={b.venue.photo} style={styles.photo} recyclingKey={b.id} />
        <View style={styles.info}>
          <Text variant="title" numberOfLines={1}>
            {b.venue.name}
          </Text>
          <View style={styles.line}>
            <MapPin size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
              {b.venue.area || b.format}
            </Text>
          </View>
          <View style={styles.line}>
            <CalendarDays size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
              {whenLabel(b)}
            </Text>
          </View>
          <Text variant="caption" color={colors.textMuted}>
            {b.format} · paid {formatTaka(b.amountPaid)}
          </Text>
        </View>
      </View>
      <View style={styles.bookingAction}>
        <Button label="Find players or an opponent" icon={UsersRound} small onPress={onOpen} />
      </View>
    </Card>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: gutter, paddingVertical: space[2] },
  titleBlock: { flex: 1, alignItems: 'center', gap: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[5] },
  banner: { height: 152, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#06361A', justifyContent: 'center' },
  bannerImg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bannerText: { paddingHorizontal: space[5], gap: space[2], maxWidth: '78%' },
  bannerSub: { fontFamily: font.regular },
  bannerTitle: { fontFamily: font.medium, fontSize: 26, lineHeight: 31, letterSpacing: -0.5 },
  section: { gap: space[3] },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[1] },
  sectionTitle: { flex: 1, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  empty: { paddingTop: space[4] },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingHorizontal: space[1] },
  booking: { borderRadius: radius.xl, overflow: 'hidden' },
  bookingTop: { flexDirection: 'row', gap: space[3], padding: space[3] },
  photo: { width: 88, height: 88, borderRadius: radius.md },
  info: { flex: 1, gap: 4, paddingTop: 2, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bookingAction: { paddingHorizontal: space[3], paddingBottom: space[3] },
}));
