import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useScrollToTop } from 'expo-router';
import { Bell, ChevronDown, MapPin, Menu, Radar, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { SideMenu } from '@/components/navigation/side-menu';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { SectionTitle } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { IconButton } from '@/components/ui/icon-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { DEFAULT_DISTANCE, DistanceWheel } from '@/components/ui/distance-wheel';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { useExplore } from '@/features/api/queries';
import type { VenueSummary } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { dhakaToday } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, size, space } from '@/theme/tokens';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };
const HEADER_BTN = 44;
const SEARCH_H = 52;

type Row = { type: 'header'; key: string; title: string; hint?: string } | { type: 'venue'; key: string; venue: VenueSummary };

export default function Explore() {
  const listRef = useRef<FlashListRef<Row>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const bottom = useTabBarSpace();
  const { place } = useSession();
  const day = dhakaToday(); // Explore shows today's availability; the turf page picks other days
  const [radiusKm, setRadiusKm] = useState(DEFAULT_DISTANCE);
  const [sheet, setSheet] = useState<null | 'menu' | 'distance'>(null);
  const scrolled = useScrolled();

  const params = useMemo(
    () => ({ lat: place.lat, lng: place.lng, day, format: 'any' as const, radiusKm }),
    [place.lat, place.lng, day, radiusKm],
  );
  const { data, isPending, isError, error, refetch } = useExplore(params);
  const pull = usePullToRefresh(refetch);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    if (data.near.length) {
      out.push({ type: 'header', key: 'h-near', title: 'Recommended nearby', hint: `Within ${radiusKm} km` });
      data.near.forEach((v) => out.push({ type: 'venue', key: v.id, venue: v }));
    }
    if (data.further.length) {
      out.push({
        type: 'header',
        key: 'h-far',
        title: data.near.length ? 'A bit further' : 'Closest to you',
        hint: data.near.length ? undefined : `Within ${radiusKm} km`,
      });
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
      <View style={styles.hero}>
        <Image
          source={require('@/assets/photos/hero-ball.webp')}
          style={styles.heroImg}
          contentFit="cover"
          contentPosition="right center"
          priority="high"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
        {/* Feather the photo's edges into the page so it never shows a box. */}
        <LinearGradient
          pointerEvents="none"
          colors={[colors.bg, 'rgba(244,245,240,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fadeLeft}
        />
        <LinearGradient pointerEvents="none" colors={['rgba(244,245,240,0)', colors.bg]} style={styles.fadeBottom} />
        <LinearGradient pointerEvents="none" colors={[colors.bg, 'rgba(244,245,240,0)']} style={styles.fadeTop} />
        <View style={styles.heroText}>
          <View style={styles.accent} />
          <Text variant="display" style={styles.display}>
            {'Find your\nnext pitch.'}
          </Text>
          <Text variant="caption" color={colors.textMuted} style={styles.tagline} numberOfLines={1}>
            THE CITY IS YOUR PLAYGROUND
          </Text>
        </View>
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
            <IconButton icon={Bell} label="Notifications" badge size={HEADER_BTN} onPress={() => router.push('/notifications')} />
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
        contentContainerStyle={{ paddingBottom: bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          isPending ? (
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sticky: { paddingBottom: space[2] },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: gutter, paddingTop: space[2] },
  place: { flex: 1, alignItems: 'center', gap: 1, minHeight: HEADER_BTN, justifyContent: 'center', paddingHorizontal: space[1] },
  placeKicker: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.6 },
  placeName: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: space[2] },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%' },
  hero: { height: 164, justifyContent: 'flex-end', paddingBottom: space[3], overflow: 'hidden' }, // keep the photo (and its pitch base) inside the fades
  heroImg: { position: 'absolute', right: -50, top: -10, width: 380, height: 215 },
  fadeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '55%' },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  fadeTop: { position: 'absolute', left: 0, right: 0, top: -10, height: 50 },
  heroText: { paddingHorizontal: gutter, gap: space[2], maxWidth: 252 },
  accent: { width: 46, height: 5, borderRadius: 3, backgroundColor: colors.lime },
  display: { fontSize: 30, lineHeight: 32, letterSpacing: -0.9 },
  tagline: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.4 },
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
});
