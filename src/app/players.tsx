import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowLeft, Bell, CalendarDays, Info, MapPin, UsersRound, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JoinSheet, MatchCard, dayLabel } from '@/components/match/match-ui';
import { CalendarModal } from '@/components/ui/calendar';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useMatchFeed } from '@/features/api/queries';
import type { Match } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { addDays, dhakaToday, type DayKey } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const NO_ANCHOR = { disabled: true };

/**
 * Find players: open spots on games other players have already booked and paid for.
 * Filters: Nearby (within 10 km of your place; off by default) and a date.
 * Loads 10 games at a time; the next 10 as you reach the end.
 */
export default function Players() {
  const insets = useSafeAreaInsets();
  const { place } = useSession();
  const [nearby, setNearby] = useState(false);
  const [day, setDay] = useState<DayKey | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [joining, setJoining] = useState<Match | null>(null);
  const scrolled = useScrolled();

  const params = useMemo(() => ({ lat: place.lat, lng: place.lng, nearby, day }), [place.lat, place.lng, nearby, day]);
  const feed = useMatchFeed(params);
  const pull = usePullToRefresh(feed.refetch);
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const loading = feed.isPending || (feed.isPlaceholderData && feed.isFetching);

  // "Your squad is 1 player away." — the game closest to full among the open ones.
  const fewest = useMemo(() => {
    const open = items.filter((m) => m.my !== 'owner' && m.my !== 'paid' && m.spotsLeft > 0).map((m) => m.spotsLeft);
    return open.length ? Math.min(...open) : null;
  }, [items]);

  const onEnd = useCallback(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [feed]);

  const today = dhakaToday();
  const header = (
    <View style={styles.headerBlock}>
      {/* Banner: your image, the live headline on top. */}
      <View style={styles.banner}>
        <Image source={require('@/assets/banners/players-bg.webp')} style={styles.bannerImg} contentFit="cover" contentPosition="right center" transition={0} />
        <View style={styles.bannerText}>
          <Text variant="h1" color="#FFFFFF" style={styles.bannerTitle}>
            {fewest === null ? 'Find your next game.' : `Your squad is ${fewest} player${fewest === 1 ? '' : 's'} away.`}
          </Text>
          <Text variant="label" color="rgba(255,255,255,0.78)">
            Join a game near you. Pay only when you&apos;re accepted.
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        <Chip
          label="Nearby"
          icon={MapPin}
          active={nearby}
          tone="dark"
          onPress={() => {
            haptic.select();
            setNearby((v) => !v);
          }}
        />
        <Chip label={day ? dayLabel(day) : 'Today'} icon={CalendarDays} active={!!day} tone="dark" onPress={() => setPicking(true)} />
        {day ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Any date" onPress={() => setDay(undefined)} hitSlop={8} style={styles.clear}>
            <X size={16} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.sectionRow}>
        <Text variant="h2" style={styles.flex}>
          {nearby ? 'Games near you' : 'Open games'}
        </Text>
        {!loading ? (
          <Text variant="label" color={colors.textMuted}>
            {items.length}
            {feed.hasNextPage ? '+' : ''} {items.length === 1 ? 'match' : 'matches'}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <View style={styles.flex}>
            <Text variant="pageTitle" numberOfLines={1}>
              Find players
            </Text>
            <View style={styles.placeRow}>
              <MapPin size={14} color={colors.textMuted} strokeWidth={1.8} />
              <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                {[place.name, place.city].filter(Boolean).join(', ')}
              </Text>
            </View>
          </View>
          <IconButton icon={Bell} label="Notifications" onPress={() => router.push('/notifications')} />
        </View>
      </StickyHeader>

      {feed.isError && !items.length ? (
        <ErrorState message={feed.error.message} onRetry={feed.refetch} />
      ) : (
        <FlashList
          data={loading ? [] : items}
          keyExtractor={(m) => m.id}
          maintainVisibleContentPosition={NO_ANCHOR}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <MatchCard m={item} onJoin={setJoining} />
            </View>
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? (
              <View style={styles.skeletons}>
                {[0, 1].map((i) => (
                  <Skeleton key={i} height={250} r={radius.xl} />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <EmptyState
                  icon={UsersRound}
                  title={day || nearby ? 'No games match these filters' : 'No open games right now'}
                  body="When players open spots on their bookings, they show up here."
                />
              </View>
            )
          }
          ListFooterComponent={
            <View style={[styles.footer, { paddingBottom: insets.bottom + space[6] }]}>
              {items.length ? <ListLoader loading={feed.isFetchingNextPage} /> : null}
              {items.length && !feed.hasNextPage ? (
                <View style={styles.note}>
                  <Info size={16} color={colors.textMuted} strokeWidth={1.8} />
                  <Text variant="label" color={colors.textMuted}>
                    Join requests are approved by the organiser.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          onEndReached={onEnd}
          onEndReachedThreshold={END_THRESHOLD}
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <JoinSheet match={joining} onClose={() => setJoining(null)} />
      <CalendarModal
        visible={picking}
        title="Pick a day"
        value={day ? [day] : [today]}
        min={today}
        max={addDays(today, 30)}
        onConfirm={(d) => {
          setDay(d[0]);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: gutter, paddingVertical: space[2] },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerBlock: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[4] },
  banner: { height: 152, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#06361A', justifyContent: 'center' },
  bannerImg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bannerText: { paddingHorizontal: space[5], gap: space[2], maxWidth: '78%' },
  bannerTitle: { fontSize: 26, lineHeight: 30, letterSpacing: -0.6 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  clear: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1], marginBottom: space[1] },
  item: { paddingHorizontal: gutter, paddingBottom: space[3] },
  skeletons: { paddingHorizontal: gutter, gap: space[3] },
  empty: { paddingHorizontal: gutter, paddingTop: space[6] },
  footer: { alignItems: 'center', gap: space[3], paddingTop: space[2] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: gutter },
}));
