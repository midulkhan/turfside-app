import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowLeft, Bell, CalendarDays, Info, MapPin, Swords, UsersRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MatchCard, dayLabel } from '@/components/match/match-ui';
import { CalendarModal } from '@/components/ui/calendar';
import { Chip } from '@/components/ui/chip';
import { Segmented } from '@/components/ui/segmented';
import { IconButton } from '@/components/ui/icon-button';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useMatchFeed } from '@/features/api/queries';
import { useLiveMatchFeed, useRefreshAt } from '@/features/api/realtime';
import type { MatchType } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { prefs } from '@/lib/storage';
import { addDays, dhakaToday, type DayKey } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, font, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const NO_ANCHOR = { disabled: true };
const KIND_KEY = 'ts.joinKind';
const KINDS: { value: MatchType; label: string }[] = [
  { value: 'players', label: 'Players' },
  { value: 'opponent', label: 'Opponents' },
];

/**
 * Join a squad: open spots on games other players have already booked and paid for, or (the
 * Opponents switch, remembered between visits) teams looking for a whole team to play.
 * (Your own games live on Find players.)
 * Filters: Nearby (within 10 km of your place; off by default) and a date.
 * Loads 10 games at a time; the next 10 as you reach the end.
 */
export default function JoinSquad() {
  const insets = useSafeAreaInsets();
  const { place } = useSession();
  const [nearby, setNearby] = useState(false);
  const [day, setDay] = useState<DayKey | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<MatchType>('players');
  const scrolled = useScrolled();
  const opponents = kind === 'opponent';
  useEffect(() => {
    prefs
      .get(KIND_KEY)
      .then((v) => v === 'opponent' && setKind('opponent'))
      .catch(() => {});
  }, []);
  const pickKind = (k: MatchType) => {
    setKind(k);
    prefs.set(KIND_KEY, k).catch(() => {});
  };

  const params = useMemo(() => ({ lat: place.lat, lng: place.lng, nearby, day, type: kind }), [place.lat, place.lng, nearby, day, kind]);
  const feed = useMatchFeed(params);
  const pull = usePullToRefresh(feed.refetch);
  // Your own games are on Find players; here are the ones you can join.
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items).filter((m) => m.my !== 'owner') ?? [], [feed.data]);
  const loading = feed.isPending || (feed.isPlaceholderData && feed.isFetching);

  // Live: requests, acceptances and payments show up as they happen; a held spot whose
  // 5-minute pay window runs out comes back on its own.
  useLiveMatchFeed();
  const nextRelease = useMemo(() => {
    const t = items.map((m) => m.reservedUntil ?? 0).filter((x) => x > 0); // the server sends only future ones
    return t.length ? Math.min(...t) : null;
  }, [items]);
  useRefreshAt(nextRelease, feed.refetch);

  // "Your squad is 1 player away." — the game closest to full among the open ones.
  const fewest = useMemo(() => {
    const open = items.filter((m) => m.my !== 'owner' && m.my !== 'paid' && m.spotsLeft > 0).map((m) => m.spotsLeft);
    return open.length ? Math.min(...open) : null;
  }, [items]);
  const headline = opponents
    ? items.length
      ? `${items.length}${feed.hasNextPage ? '+' : ''} team${items.length === 1 ? '' : 's'} want a game.`
      : 'Find a team to play.'
    : fewest === null
      ? 'Find your next game.'
      : `Your squad is ${fewest} player${fewest === 1 ? '' : 's'} away.`;

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
          <Text variant="h1" color="#FFFFFF" style={styles.bannerTitle} maxFontSizeMultiplier={1.1}>
            {headline}
          </Text>
          <Text variant="label" color="rgba(255,255,255,0.8)" style={styles.bannerSub}>
            {opponents ? 'Challenge a team with a booked turf. Your team pays only when accepted.' : 'Join a game near you. Pay only when you’re accepted.'}
          </Text>
        </View>
      </View>

      <Segmented large accessibilityLabel="Looking for" value={kind} onChange={pickKind} options={KINDS} />

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
        <Text variant="title" style={styles.sectionTitle}>
          {opponents ? (nearby ? 'Teams near you' : 'Teams looking for a game') : nearby ? 'Games near you' : 'Open games'}
        </Text>
        {!loading ? (
          <Text variant="label" color={colors.textMuted}>
            {items.length}
            {feed.hasNextPage ? '+' : ''} {opponents ? (items.length === 1 ? 'team' : 'teams') : items.length === 1 ? 'match' : 'matches'}
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
          {/* Same header as the rest of the app: centred title, place underneath. */}
          <View style={styles.titleBlock}>
            <Text variant="title" numberOfLines={1}>
              Join a squad
            </Text>
            <View style={styles.placeRow}>
              <MapPin size={12} color={colors.textMuted} strokeWidth={1.8} />
              <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
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
              <MatchCard m={item} />
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
                  icon={opponents ? Swords : UsersRound}
                  title={day || nearby ? (opponents ? 'No teams match these filters' : 'No games match these filters') : opponents ? 'No teams looking right now' : 'No open games right now'}
                  body={
                    opponents
                      ? 'When a team posts its booking to find an opponent, it shows up here. Have a booking? Post it from Find players.'
                      : 'When players open spots on their bookings, they show up here.'
                  }
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
                    {opponents ? 'The host picks the team they play.' : 'Join requests are approved by the organiser.'}
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
  titleBlock: { flex: 1, alignItems: 'center', gap: 1 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  headerBlock: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[4] },
  banner: { height: 152, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#06361A', justifyContent: 'center' },
  bannerImg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bannerText: { paddingHorizontal: space[5], gap: space[2], maxWidth: '78%' },
  // Light like the Explore banners, not a bold headline.
  bannerSub: { fontFamily: font.regular },
  bannerTitle: { fontFamily: font.medium, fontSize: 26, lineHeight: 31, letterSpacing: -0.5 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  clear: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  sectionTitle: { flex: 1, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1], marginBottom: space[4] },
  item: { paddingHorizontal: gutter, paddingBottom: space[3] },
  skeletons: { paddingHorizontal: gutter, gap: space[3] },
  empty: { paddingHorizontal: gutter, paddingTop: space[6] },
  footer: { alignItems: 'center', gap: space[3], paddingTop: space[2] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: gutter },
}));
