import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useScrollToTop } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, MapPin, Menu, Radar, Search, ShoppingBag } from 'lucide-react-native';
import { useCallback, useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SideMenu } from '@/components/navigation/side-menu';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Chip } from '@/components/ui/chip';
import { Overline, SectionTitle } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { DEFAULT_DISTANCE, DistanceWheel } from '@/components/ui/distance-wheel';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { qk, useExplore, useMyHolds } from '@/features/api/queries';
import type { VenueSummary } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { dhakaToday } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, size, space } from '@/theme/tokens';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

type Row = { type: 'header'; key: string; title: string; hint?: string } | { type: 'venue'; key: string; venue: VenueSummary };

export default function Explore() {
  const listRef = useRef<FlashListRef<Row>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const { place } = useSession();
  const day = dhakaToday(); // Explore shows today's availability; the turf page picks other days
  const [radiusKm, setRadiusKm] = useState(DEFAULT_DISTANCE);
  const [sheet, setSheet] = useState<null | 'menu' | 'distance'>(null);

  // Cart = the slot you're holding. The icon goes straight to its checkout.
  const qc = useQueryClient();
  const holds = useMyHolds().data ?? []; // the server lists only unexpired holds
  const latestHold = holds.reduce<(typeof holds)[number] | undefined>((a, h) => (!a || h.expiresAt > a.expiresAt ? h : a), undefined);
  const openCart = () => {
    if (!latestHold) return;
    qc.setQueryData(qk.hold(latestHold.holdId), latestHold);
    router.push({ pathname: '/checkout', params: { holdId: latestHold.holdId } });
  };

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
                <Text variant="label" color={colors.textMuted}>
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
      <View style={[styles.topBar, { paddingTop: insets.top + space[2] }]}>
        <IconButton icon={Menu} label="Menu" onPress={() => setSheet('menu')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playing near ${place.name}. Change location`}
          onPress={() => router.push('/locations')}
          style={styles.place}>
          <Overline>Playing near</Overline>
          <View style={styles.placeRow}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.placeName}>
              {place.label ? `${place.label} · ${place.name}` : [place.name, place.city].filter(Boolean).join(', ')}
            </Text>
            <ChevronDown size={18} color={colors.ink} strokeWidth={2.2} />
          </View>
        </Pressable>
        <View style={styles.actions}>
          <IconButton
            icon={ShoppingBag}
            label={latestHold ? `Cart, continue to checkout for ${latestHold.venue.name}` : 'Cart is empty'}
            count={holds.length}
            disabled={!latestHold}
            onPress={openCart}
          />
          <IconButton icon={Bell} label="Notifications" badge onPress={() => router.push('/notifications')} />
        </View>
      </View>

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
          <Overline color={colors.text}>The city is your playground</Overline>
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
      </View>

      <View style={styles.chips}>
        <Chip
          label={`Distance · ${radiusKm} km`}
          icon={Radar}
          active={radiusKm !== DEFAULT_DISTANCE}
          onPress={() => setSheet('distance')}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlashList
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
  placeName: { maxWidth: 240 },
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, zIndex: 2 },
  place: { alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space[2] },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hero: { height: 172, justifyContent: 'center', marginTop: -space[2] },
  heroImg: { position: 'absolute', right: -50, top: -10, width: 380, height: 215 },
  fadeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '55%' },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  fadeTop: { position: 'absolute', left: 0, right: 0, top: -10, height: 50 },
  heroText: { paddingHorizontal: gutter, gap: space[2] },
  accent: { width: 46, height: 5, borderRadius: 3, backgroundColor: colors.lime },
  display: { marginBottom: space[1] },
  searchRow: { flexDirection: 'row', gap: space[3], paddingHorizontal: gutter },
  search: {
    flex: 1,
    height: size.control,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
  },
  chips: { flexDirection: 'row', gap: space[2], paddingHorizontal: gutter, marginTop: space[3] },
  flex: { flex: 1, gap: 2 },
  section: { paddingHorizontal: gutter, paddingTop: space[6], paddingBottom: space[3] },
  card: { paddingHorizontal: gutter, paddingBottom: space[4] },
  skeletons: { paddingHorizontal: gutter, paddingTop: space[7], gap: space[4] },
});
