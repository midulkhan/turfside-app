import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { ArrowLeft, MapPin, Search as SearchIcon, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Input } from '@/components/ui/input';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { Overline } from '@/components/ui/headers';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { KNOWN_AREAS } from '@/lib/places';
import { useExploreFeed } from '@/features/api/queries';
import type { VenueSummary } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { dhakaToday } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

/**
 * Search, kept light on the server the way big apps do it:
 * - debounced (300 ms), nothing under 2 letters, each new query aborts the last;
 * - queries are normalised (trim + lowercase) so "Bad" and "bad" share one cache entry;
 * - narrowing is local: the server matches `name + area` (or the turf ID) containing the text, so once
 *   "bad" is fetched, "badd", "badda"… are a subset of it and are filtered on the phone
 *   instantly, with no request (and no debounce wait);
 * - React Query caches each query, so going back to a previous one costs nothing.
 */
const norm = (s: string) => s.trim().toLowerCase();

/** Same rule as the server: name or area, or the turf ID ("TS-5741", "5741", "574"). */
const matches = (v: VenueSummary, q: string) => {
  if (`${v.name} ${v.area}`.toLowerCase().includes(q)) return true;
  const id = q.replace(/[\s-]/g, '');
  const ref = v.ref ? v.ref.toLowerCase().replace(/[\s-]/g, '') : '';
  return !!ref && id.length >= 3 && /\d/.test(id) && (ref.includes(id) || `ts${id}` === ref);
};

export default function Search() {
  const insets = useSafeAreaInsets();
  const { place, setPlace } = useSession();
  const [text, setText] = useState('');
  const typed = norm(text);
  const q = useDebouncedValue(typed, 300);
  const placeKey = `${place.lat},${place.lng}`;

  // Last full answer from the server; any longer query containing its text is a subset of it.
  // Only a complete answer (every page loaded) can be narrowed on the phone.
  const [base, setBase] = useState<{ q: string; place: string; venues: VenueSummary[]; complete: boolean } | null>(null);
  // Not for digits: an ID only matches from 3 characters ("57" → nothing, "574" → TS-5741).
  const covers = (s: string) => !!base && base.complete && base.place === placeKey && s.length >= 2 && s.includes(base.q) && !/\d/.test(s);

  const enabled = q.length >= 2 && !covers(q); // no request until there's a query, or when we can narrow locally
  const params = useMemo(
    () => ({ lat: place.lat, lng: place.lng, day: dhakaToday(), format: 'any' as const, query: q }),
    [place.lat, place.lng, q],
  );
  const { data, isFetching, isPlaceholderData, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useExploreFeed(params, enabled);
  const count = data ? data.near.length + data.further.length : 0;
  if (enabled && data && !isPlaceholderData && !isFetching && (base?.q !== q || base.place !== placeKey || base.venues.length !== count || base.complete !== !hasNextPage)) {
    setBase({ q, place: placeKey, venues: [...data.near, ...data.further], complete: !hasNextPage });
  }

  const local = covers(typed); // instant: filter what we already have, no debounce, no request
  // Typing ahead of the debounce, or a new query in flight: never show the previous query's results.
  const searching = !local && typed.length >= 2 && ((isFetching && !isFetchingNextPage && (isPlaceholderData || !data)) || typed !== q);
  const scrolled = useScrolled();
  const results = local
    ? base!.venues.filter((v) => matches(v, typed))
    : enabled && data && !searching && !isError
      ? [...data.near, ...data.further]
      : [];
  const shownQ = local ? typed : q;
  const hasQuery = typed.length >= 2;
  const areas = hasQuery ? KNOWN_AREAS.filter((a) => a.name.toLowerCase().includes(typed)) : KNOWN_AREAS.slice(0, 6);

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress} style={styles.sticky}>
        <View style={styles.bar}>
          <IconButton icon={ArrowLeft} label="Go back" onPress={() => router.back()} />
          <Input
            containerStyle={styles.flex}
            icon={SearchIcon}
            placeholder="Search turfs, areas or turf ID"
            value={text}
            onChangeText={setText}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            maxLength={60}
            trailing={
              searching ? (
                <ActivityIndicator color={colors.ink} />
              ) : text ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={10}>
                  <X size={20} color={colors.textMuted} />
                </Pressable>
              ) : null
            }
          />
        </View>
      </StickyHeader>

      <FlashList
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        data={results}
        keyExtractor={(v) => v.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => !local && hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={END_THRESHOLD}
        ListFooterComponent={results.length && !local ? <ListLoader loading={isFetchingNextPage} /> : null}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <VenueCard venue={item} />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.areas}>
            {areas.length ? <Overline>{hasQuery ? 'Areas' : 'Popular areas'}</Overline> : null}
            <View style={styles.areaWrap}>
              {areas.map((a) => (
                <Pressable
                  key={a.name}
                  accessibilityRole="button"
                  onPress={() => {
                    setPlace({ ...a, source: 'manual' });
                    router.back();
                  }}
                  style={styles.area}>
                  <MapPin size={16} color={colors.ink} />
                  <Text variant="labelStrong">{a.name}</Text>
                </Pressable>
              ))}
            </View>
            {results.length ? <Overline>Turfs</Overline> : null}
          </View>
        }
        ListEmptyComponent={
          searching ? (
            <View style={styles.item}>
              <VenueCardSkeleton />
            </View>
          ) : isError && enabled && !local ? (
            <ErrorState message="Couldn’t search right now. Check your connection." onRetry={refetch} />
          ) : hasQuery ? (
            <EmptyState icon={SearchIcon} title="No turfs found" body={`Nothing matches “${shownQ}” yet. Try an area name like Uttara.`} />
          ) : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
      />
    </View>
  );
}

const styles = createStyles(() => ({
  sticky: { paddingTop: space[2], paddingBottom: space[2] },
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: gutter, paddingBottom: space[3] },
  areas: { paddingHorizontal: gutter, gap: space[3], paddingTop: space[3], paddingBottom: space[3] },
  areaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  area: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: { paddingHorizontal: gutter, paddingBottom: space[4] },
}));
