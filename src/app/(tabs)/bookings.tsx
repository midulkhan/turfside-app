import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, useScrollToTop } from 'expo-router';
import { CalendarDays, Clock3, QrCode, RotateCcw, UsersRound } from 'lucide-react-native';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Segmented } from '@/components/ui/segmented';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { Overline } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { qk, useBookingPages, useJoinedMatches } from '@/features/api/queries';
import type { Booking, Match } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { dhakaToday, formatDay, formatRange } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

type Filter = 'all' | 'open' | 'closed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

/** Open = a game still ahead of you (booked, today or later). Everything else (played, past, cancelled) is closed. */
const isOpen = (b: Booking, today: string) => (b.status === 'confirmed' || b.status === 'checked_in') && b.day >= today;

const OPEN = () => ({ label: 'Open', bg: colors.limeSoft, fg: colors.limeText });
const CLOSED = () => ({ label: 'Closed', bg: colors.surfaceMuted, fg: colors.textMuted });

const BookingRow = memo(function BookingRow({ b, today }: { b: Booking; today: string }) {
  const live = isOpen(b, today);
  const s = live ? OPEN() : CLOSED();
  const open = () => router.push({ pathname: '/booking/[id]', params: { id: b.id } });
  // "Book again" goes to the turf itself, not this booking.
  const bookAgain = () => router.push({ pathname: '/venue/[id]', params: { id: b.venue.id } });
  return (
    <PressableScale
      scaleTo={0.985}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${b.venue.name}, ${formatDay(b.day)}, ${s.label}`}>
      <Card style={styles.row}>
        <Photo source={b.venue.photo} style={styles.thumb} recyclingKey={b.id} />
        <View style={styles.flex}>
          <View style={styles.rowTop}>
            <Text variant="title" numberOfLines={1} style={styles.flex}>
              {b.venue.name}
            </Text>
            <View style={[styles.pill, { backgroundColor: s.bg }]}>
              <Text variant="caption" color={s.fg}>
                {s.label}
              </Text>
            </View>
          </View>
          <Text variant="label" color={colors.textMuted}>
            {formatDay(b.day, { year: false })} · {formatRange(b.start, b.end)}
          </Text>
          <View style={styles.rowBottom}>
            <Text variant="labelStrong">{formatTaka(b.amountPaid)}</Text>
            {live ? (
              <View style={styles.link}>
                <QrCode size={15} color={colors.ink} />
                <Text variant="labelStrong" style={styles.u}>
                  View ticket
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Book ${b.venue.name} again`}
                onPress={bookAgain}
                hitSlop={10}
                style={styles.link}>
                <RotateCcw size={15} color={colors.ink} />
                <Text variant="labelStrong" style={styles.u}>
                  Book again
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </Card>
    </PressableScale>
  );
});

/** A squad you paid to join (someone else's booking). Opens the match. */
function SquadRow({ m, today }: { m: Match; today: string }) {
  const live = m.status !== 'cancelled' && m.day >= today;
  const spots = m.mySpots ?? 1;
  return (
    <PressableScale
      scaleTo={0.985}
      onPress={() => router.push({ pathname: '/game/[id]', params: { id: m.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Squad ${m.title} at ${m.venue.name}, ${formatDay(m.day)}`}>
      <Card style={styles.row}>
        <Photo source={m.venue.photo} style={styles.thumb} recyclingKey={`sq:${m.id}`} />
        <View style={styles.flex}>
          <View style={styles.rowTop}>
            <Text variant="title" numberOfLines={1} style={styles.flex}>
              {m.venue.name}
            </Text>
            <View style={[styles.pill, { backgroundColor: live ? colors.limeSoft : colors.surfaceMuted }]}>
              <Text variant="caption" color={live ? colors.limeText : colors.textMuted}>
                {m.status === 'cancelled' ? 'Cancelled' : live ? (m.type === 'opponent' ? 'Team vs Team' : 'Squad') : 'Played'}
              </Text>
            </View>
          </View>
          <Text variant="label" color={colors.textMuted} numberOfLines={1}>
            {formatDay(m.day, { year: false })} · {formatRange(m.start, m.end)}
          </Text>
          <View style={styles.rowBottom}>
            <Text variant="labelStrong">{formatTaka(m.type === 'opponent' ? m.share : m.share * spots)}</Text>
            <View style={[styles.link, styles.shrink]}>
              <UsersRound size={15} color={colors.ink} />
              {/* A long squad name shortens with "…"; the spot count always shows in full. */}
              <Text variant="labelStrong" numberOfLines={1} style={styles.shrink}>
                {m.title}
              </Text>
              <Text variant="labelStrong" numberOfLines={1}>
                · {m.type === 'opponent' ? 'your team' : spots === 1 ? '1 spot' : `${spots} spots`}
              </Text>
            </View>
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

export default function Bookings() {
  const listRef = useRef<FlashListRef<Booking | Match>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const scrolled = useScrolled();
  const bottom = useTabBarSpace();
  const [filter, setFilter] = useState<Filter>('open'); // upcoming first
  // Your own bookings and the squads you paid into live in separate tabs.
  const [tab, setTab] = useState<'bookings' | 'squads'>('bookings');
  // 10 at a time, filtered on the server; the first page also says which game is next.
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useBookingPages(filter);
  const joined = useJoinedMatches();
  const pull = usePullToRefresh(() => Promise.all([refetch(), joined.refetch()]));
  const today = dhakaToday();
  // Squads you paid into, split like bookings: still ahead (All/Open) or done (All/Closed).
  const squads = useMemo(() => {
    const all = joined.data ?? [];
    const ahead = all.filter((m) => m.status !== 'cancelled' && m.day >= today).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
    const done = all.filter((m) => !(m.status !== 'cancelled' && m.day >= today));
    return filter === 'open' ? ahead : filter === 'closed' ? done : [...ahead, ...done];
  }, [joined.data, filter, today]);
  const qc = useQueryClient();
  // Warm the other two filters so switching is instant.
  useEffect(() => {
    (['all', 'open', 'closed'] as const).forEach((f) => {
      if (f !== filter) void qc.prefetchInfiniteQuery({ queryKey: qk.bookingPages(f), initialPageParam: 0, queryFn: ({ signal }) => api.getBookingPage(f, 0, signal), staleTime: 30_000 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { next, list } = useMemo(() => {
    const nextB = data?.pages[0]?.next ?? undefined;
    const items = data?.pages.flatMap((p) => p.items) ?? [];
    return { next: nextB, list: items.filter((b) => b.id !== nextB?.id || filter === 'closed') };
  }, [data, filter]);

  const showNext = tab === 'bookings' && !!next && (filter === 'all' || filter === 'open');
  const header = (
    <View style={[styles.header, { paddingTop: space[4] }]}>
      {showNext && next ? (
        <PressableScale scaleTo={0.985} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: next.id } })}>
          <Card tone="dark" padded={false} style={styles.next}>
            <Photo source={next.venue.photo} style={styles.nextPhoto} />
            <View style={styles.nextBody}>
              <Overline color={colors.lime}>Next game</Overline>
              <Text variant="h2" color={colors.textOnDark}>
                {next.venue.name}
              </Text>
              <View style={styles.meta}>
                <View style={styles.metaItem}>
                  <CalendarDays size={16} color={colors.textOnDarkMuted} />
                  <Text variant="label" color={colors.textOnDark}>
                    {formatDay(next.day, { year: false })}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Clock3 size={16} color={colors.textOnDarkMuted} />
                  <Text variant="label" color={colors.textOnDark}>
                    {formatRange(next.start, next.end)}
                  </Text>
                </View>
              </View>
              <Button
                label="View ticket"
                icon={QrCode}
                small
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: next.id } })}
                style={styles.nextBtn}
              />
            </View>
          </Card>
        </PressableScale>
      ) : null}
      {tab === 'bookings' && list.length && showNext ? <Overline>{filter === 'open' ? 'Coming up' : 'All bookings'}</Overline> : null}
    </View>
  );

  const rows: (Booking | Match)[] = tab === 'bookings' ? list : squads;
  const loading = tab === 'bookings' ? isPending : joined.isPending;
  const failed = tab === 'bookings' ? isError : joined.isError;

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.sticky}>
          <Text variant="pageTitle">My bookings</Text>
          <Segmented
            large
            accessibilityLabel="Show"
            value={tab}
            onChange={(t) => {
              setTab(t);
              listRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            options={[
              { value: 'bookings', label: 'Bookings' },
              { value: 'squads', label: joined.data?.length ? `Squads joined · ${joined.data.length}` : 'Squads joined' },
            ]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} active={filter === f.key} tone="dark" small onPress={() => setFilter(f.key)} />
            ))}
          </ScrollView>
        </View>
      </StickyHeader>
      <FlashList
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        ref={listRef}
        data={rows}
        keyExtractor={(r) => `${tab}:${r.id}`}
        getItemType={() => tab}
        renderItem={({ item }) => (
          <View style={styles.item}>
            {tab === 'bookings' ? <BookingRow b={item as Booking} today={today} /> : <SquadRow m={item as Match} today={today} />}
          </View>
        )}
        ListHeaderComponent={header}
        ListFooterComponent={tab === 'bookings' && list.length ? <ListLoader loading={isFetchingNextPage} /> : null}
        onEndReached={() => tab === 'bookings' && hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={END_THRESHOLD}
        contentContainerStyle={{ paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.item}>
              {tab === 'bookings' ? <Skeleton height={190} r={radius.lg} /> : null}
              <View style={{ height: space[3] }} />
              <Skeleton height={96} r={radius.lg} />
            </View>
          ) : failed ? (
            <ErrorState message={(tab === 'bookings' ? error?.message : joined.error?.message) ?? 'Something went wrong.'} onRetry={tab === 'bookings' ? refetch : joined.refetch} />
          ) : showNext ? null : tab === 'bookings' ? (
            <EmptyState
              icon={CalendarDays}
              title={filter === 'closed' ? 'No past bookings' : filter === 'open' ? 'No upcoming bookings' : 'Nothing here yet'}
              body="Your games will show up here once you book a slot."
              action="Find a turf"
              onAction={() => router.navigate('/explore')}
            />
          ) : (
            <EmptyState
              icon={UsersRound}
              title={filter === 'closed' ? 'No past squads' : 'No squads yet'}
              body="Squads you pay to join show up here, with your entry pass."
              action="Join a squad"
              onAction={() => router.push('/join')}
            />
          )
        }
      />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  shrink: { flexShrink: 1, minWidth: 0 },
  header: { paddingHorizontal: gutter, gap: space[4], paddingBottom: space[3] },
  filters: { gap: space[2] },
  sticky: { paddingHorizontal: gutter, paddingTop: space[4], paddingBottom: space[3], gap: space[3] },
  next: { overflow: 'hidden' },
  nextPhoto: { height: 120, margin: 6, borderRadius: radius.md },
  nextBody: { padding: space[4], paddingTop: space[2], gap: space[2] },
  meta: { flexDirection: 'row', gap: space[4] },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextBtn: { alignSelf: 'flex-start', marginTop: space[2] },
  item: { paddingHorizontal: gutter, paddingBottom: space[3] },
  row: { flexDirection: 'row', gap: space[3], padding: space[2] },
  thumb: { width: 88, height: 88 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space[3],
    marginTop: 'auto',
    paddingRight: space[2],
    paddingBottom: space[1],
  },
  pill: { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 3 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  u: { textDecorationLine: 'underline' },
}));
