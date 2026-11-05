import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { ArrowLeft, MapPin, Search as SearchIcon, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Input } from '@/components/ui/input';
import { Overline } from '@/components/ui/headers';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { KNOWN_AREAS } from '@/lib/places';
import { useExplore } from '@/features/api/queries';
import { useSession } from '@/features/session/session';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { dhakaToday } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

/**
 * Search: input is debounced (300 ms) and each new query aborts the previous
 * request, so fast typing never floods the server or shows stale results.
 */
export default function Search() {
  const insets = useSafeAreaInsets();
  const { place, setPlace } = useSession();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), 300);
  const enabled = q.length >= 2;
  const params = useMemo(
    () => ({ lat: place.lat, lng: place.lng, day: dhakaToday(), format: 'any' as const, query: q }),
    [place.lat, place.lng, q],
  );
  const { data, isFetching, isPlaceholderData, isError, refetch } = useExplore(params, enabled); // no request until there's a query
  // Typing ahead of the debounce, or a new query in flight: never show the previous query's results.
  const searching = enabled && (isFetching && (isPlaceholderData || !data) || text.trim() !== q);
  const scrolled = useScrolled();
  const results = enabled && data && !searching && !isError ? [...data.near, ...data.further] : [];
  const areas = enabled ? KNOWN_AREAS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())) : KNOWN_AREAS.slice(0, 6);

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress} style={styles.sticky}>
        <View style={styles.bar}>
          <IconButton icon={ArrowLeft} label="Go back" onPress={() => router.back()} />
          <Input
            containerStyle={styles.flex}
            icon={SearchIcon}
            placeholder="Search turfs or areas"
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
        renderItem={({ item }) => (
          <View style={styles.item}>
            <VenueCard venue={item} />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.areas}>
            {areas.length ? <Overline>{enabled ? 'Areas' : 'Popular areas'}</Overline> : null}
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
          ) : isError && enabled ? (
            <ErrorState message="Couldn’t search right now. Check your connection." onRetry={refetch} />
          ) : enabled ? (
            <EmptyState icon={SearchIcon} title="No turfs found" body={`Nothing matches “${q}” yet. Try an area name like Uttara.`} />
          ) : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
});
