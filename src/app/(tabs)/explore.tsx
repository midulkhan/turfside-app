import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router, useScrollToTop } from 'expo-router';
import { Bell, ChevronDown, MapPin, Menu, Radar, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { BannerSlider } from '@/components/explore/banner-slider';
import { SideMenu } from '@/components/navigation/side-menu';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { SectionTitle } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { IconButton } from '@/components/ui/icon-button';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { PressableScale } from '@/components/ui/pressable-scale';
import { DEFAULT_DISTANCE, DistanceWheel } from '@/components/ui/distance-wheel';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { useExploreFeed } from '@/features/api/queries';
import { useLiveExplore } from '@/features/api/realtime';
import type { VenueSummary } from '@/features/api/types';
import { useAuthGate } from '@/features/session/auth-gate';
import { useSession } from '@/features/session/session';
import { dhakaToday } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, size, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };
const HEADER_BTN = 44;
const SEARCH_H = 52;

type Row = { type: 'header'; key: string; title: string; hint?: string } | { type: 'venue'; key: string; venue: VenueSummary };

export default function Explore() {
  const listRef = useRef<FlashListRef<Row>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const bottom = useTabBarSpace();
  const { place, radiusKm, setRadiusKm, user } = useSession(); // distance is remembered (tabs, restarts)
  const { requireAuth } = useAuthGate();
  const day = dhakaToday(); // Explore shows today's availability; the turf page picks other days
  const [sheet, setSheet] = useState<null | 'menu' | 'distance'>(null);
  const scrolled = useScrolled();
  useLiveExplore(day);

  const params = useMemo(
    () => ({ lat: place.lat, lng: place.lng, day, format: 'any' as const, radiusKm }),
    [place.lat, place.lng, day, radiusKm],
  );
  const { data: fetched, isPending, isPlaceholderData, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useExploreFeed(params);
  // New distance / place: show skeletons at once instead of the old list, then the new results.
  const loading = isPending || isPlaceholderData;
  const data = loading ? undefined : fetched;
  const pull = usePullToRefresh(refetch);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    if (data.near.length) {
      out.push({ type: 'header', key: 'h-near', title: 'Recommended nearby', hint: `Within ${radiusKm} km` });
      data.near.forEach((v) => out.push({ type: 'venue', key: v.id, venue: v }));
    }
    if (data.further.length) {
      // Further turfs simply continue the list; a heading only when nothing is near.
      if (!data.near.length) out.push({ type: 'header', key: 'h-far', title: 'Closest to you', hint: `Within ${radiusKm} km` });
      data.further.forEach((v) => out.push({ type: 'venue', key: v.id, venue: v }));
    }
    return out;
  }, [data, radiusKm]);

  const renderItem = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'header')
      return (
        <View style={styles.section}>
          <SectionTitle
            title={item.title}
            right={
              item.hint ? (
                <Text variant="caption" color={colors.textMuted}>
                  {item.hint}
                </Text>
              ) : undefined
            }
          />
        </View>
      );
    return (
      <View style={styles.card}>
        <VenueCard venue={item.venue} />
      </View>
    );
  }, []);

  const header = (
    <View>
      <View style={styles.banners}>
        <BannerSlider />
      </View>

      <View style={styles.searchRow}>
        <PressableScale
          accessibilityRole="search"
          accessibilityLabel="Search turfs or areas"
          onPress={() => router.push('/search')}
          style={styles.search}
          scaleTo={0.99}>
          <Search size={size.icon} color={colors.ink} strokeWidth={2} />
          <Text variant="body" color={colors.textSubtle}>
            Search turfs or areas
          </Text>
        </PressableScale>
        <IconButton
          icon={Radar}
          label={`Distance, within ${radiusKm} km. Change`}
          variant={radiusKm !== DEFAULT_DISTANCE ? 'lime' : 'light'}
          size={SEARCH_H}
          onPress={() => setSheet('distance')}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress} style={styles.sticky}>
        <View style={styles.topBar}>
          <IconButton icon={Menu} label="Menu" size={HEADER_BTN} onPress={() => setSheet('menu')} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Playing near ${place.name}. Change location`}
            onPress={() => router.push('/locations')}
            style={styles.place}>
            <Text variant="caption" color={colors.textMuted} style={styles.placeKicker}>
              PLAYING NEAR
            </Text>
            <View style={styles.placeRow}>
              <Text variant="labelStrong" numberOfLines={1} style={styles.placeName}>
                {place.label ? `${place.label} · ${place.name}` : [place.name, place.city].filter(Boolean).join(', ')}
              </Text>
              <ChevronDown size={14} color={colors.textMuted} strokeWidth={2.4} />
            </View>
          </Pressable>
          <View style={styles.actions}>
            <IconButton
              icon={Bell}
              label="Notifications"
              badge={!!user}
              size={HEADER_BTN}
              onPress={() => requireAuth('Sign in to see your notifications', () => router.push('/notifications'))}
            />
          </View>
        </View>
      </StickyHeader>
      <FlashList
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        getItemType={(r) => r.type}
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={rows.length ? <ListLoader loading={isFetchingNextPage} /> : null}
        onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={END_THRESHOLD}
        contentContainerStyle={{ paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skeletons}>
              <VenueCardSkeleton />
              <VenueCardSkeleton />
            </View>
          ) : isError ? (
            <ErrorState message={error.message} onRetry={refetch} />
          ) : (
            <EmptyState
              icon={MapPin}
              title={`Nothing within ${radiusKm} km`}
              body="Widen the distance or try another location."
              action="Change distance"
              onAction={() => setSheet('distance')}
            />
          )
        }
      />

      <DistanceWheel visible={sheet === 'distance'} value={radiusKm} onApply={setRadiusKm} onClose={() => setSheet(null)} />
      <SideMenu visible={sheet === 'menu'} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  sticky: { paddingBottom: space[2] },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: gutter, paddingTop: space[2] },
  place: { flex: 1, alignItems: 'center', gap: 1, minHeight: HEADER_BTN, justifyContent: 'center', paddingHorizontal: space[1] },
  placeKicker: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.6 },
  placeName: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: space[2] },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  banners: { paddingTop: space[3], paddingBottom: space[4] },
  searchRow: { flexDirection: 'row', gap: space[2], paddingHorizontal: gutter },
  search: {
    flex: 1,
    height: SEARCH_H,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
  },
  flex: { flex: 1, gap: 2 },
  section: { paddingHorizontal: gutter, paddingTop: space[6], paddingBottom: space[3] },
  card: { paddingHorizontal: gutter, paddingBottom: space[4] },
  skeletons: { paddingHorizontal: gutter, paddingTop: space[7], gap: space[4] },
}));
