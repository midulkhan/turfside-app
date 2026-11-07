import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router, useScrollToTop } from 'expo-router';
import { CalendarDays, Clock3, QrCode, RotateCcw } from 'lucide-react-native';
import { memo, useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Overline } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useBookings } from '@/features/api/queries';
import type { Booking } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { dhakaToday, formatDay, formatRange } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';

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

const OPEN = { label: 'Open', bg: colors.limeSoft, fg: colors.limeText };
const CLOSED = { label: 'Closed', bg: colors.surfaceMuted, fg: colors.textMuted };

const BookingRow = memo(function BookingRow({ b, today }: { b: Booking; today: string }) {
  const live = isOpen(b, today);
  const s = live ? OPEN : CLOSED;
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

export default function Bookings() {
  const listRef = useRef<FlashListRef<Booking>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const scrolled = useScrolled();
  const bottom = useTabBarSpace();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isPending, isError, error, refetch } = useBookings();
  const pull = usePullToRefresh(refetch);
  const today = dhakaToday();

  const { next, list } = useMemo(() => {
    const all = data ?? [];
    const upcoming = all.filter((b) => isOpen(b, today)).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
    const nextB = upcoming[0];
    const filtered = all.filter((b) => (filter === 'all' ? true : filter === 'open' ? isOpen(b, today) : !isOpen(b, today)));
    return { next: nextB, list: filtered.filter((b) => b.id !== nextB?.id || filter === 'closed') };
  }, [data, filter, today]);

  const header = (
    <View style={[styles.header, { paddingTop: space[4] }]}>
      {next && (filter === 'all' || filter === 'open') ? (
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
      {list.length ? <Overline>{filter === 'all' ? 'All bookings' : FILTERS.find((f) => f.key === filter)!.label}</Overline> : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.sticky}>
          <Text variant="pageTitle">My bookings</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} active={filter === f.key} tone="dark" onPress={() => setFilter(f.key)} />
            ))}
          </ScrollView>
        </View>
      </StickyHeader>
      <FlashList
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        ref={listRef}
        data={list}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <BookingRow b={item} today={today} />
          </View>
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          isPending ? (
            <View style={styles.item}>
              <Skeleton height={190} r={radius.lg} />
              <View style={{ height: space[3] }} />
              <Skeleton height={96} r={radius.lg} />
            </View>
          ) : isError ? (
            <ErrorState message={error.message} onRetry={refetch} />
          ) : next && (filter === 'all' || filter === 'open') ? null : (
            <EmptyState
              icon={CalendarDays}
              title="Nothing here yet"
              body="Your games will show up here once you book a slot."
              action="Find a turf"
              onAction={() => router.navigate('/explore')}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
    marginTop: 'auto',
    paddingRight: space[2],
    paddingBottom: space[1],
  },
  pill: { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 3 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  u: { textDecorationLine: 'underline' },
});
