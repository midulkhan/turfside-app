import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useScrollToTop } from 'expo-router';
import { ArrowRight, Bell, ChevronDown, MapPin, Menu, Moon, Search, SlidersHorizontal } from 'lucide-react-native';
import { useCallback, useMemo, useState, useRef } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SideMenu } from '@/components/navigation/side-menu';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Chip } from '@/components/ui/chip';
import { Overline, SectionTitle } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { OptionSheet } from '@/components/ui/option-sheet';
import { PressableScale } from '@/components/ui/pressable-scale';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { useExplore } from '@/features/api/queries';
import type { PitchFormat, VenueSummary } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { addDays, dhakaToday, formatDay, type DayKey } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, size, space } from '@/theme/tokens';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

type Row = { type: 'header'; key: string; title: string } | { type: 'venue'; key: string; venue: VenueSummary };

const FORMAT_OPTIONS = [
  { value: 'any', label: 'Any format' },
  { value: '5-a-side', label: '5-a-side' },
  { value: '6-a-side', label: '6-a-side' },
  { value: '7-a-side', label: '7-a-side' },
] as const;

export default function Explore() {
  const listRef = useRef<FlashListRef<Row>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const { place } = useSession();
  const today = dhakaToday();
  const [day, setDay] = useState<DayKey>(today);
  const [format, setFormat] = useState<PitchFormat | 'any'>('5-a-side');
  const [floodlitOnly, setFloodlitOnly] = useState(false);
  // Nearby is a quick client-side filter (turfs within 5 km), so toggling it never refetches or flickers.
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [sheet, setSheet] = useState<null | 'day' | 'format' | 'filters' | 'menu'>(null);

  const params = useMemo(
    () => ({ lat: place.lat, lng: place.lng, day, format, floodlitOnly }),
    [place.lat, place.lng, day, format, floodlitOnly],
  );
  const { data, isPending, isError, error, refetch } = useExplore(params);
  const pull = usePullToRefresh(refetch);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    if (data.near.length) {
      out.push({ type: 'header', key: 'h-near', title: nearbyOnly ? 'Within 5 km' : 'Recommended nearby' });
      data.near.forEach((v) => out.push({ type: 'venue', key: v.id, venue: v }));
    }
    if (data.further.length && !nearbyOnly) {
      out.push({
        type: 'header',
        key: 'h-far',
        title: data.near.length ? 'A bit further' : 'Closest to you',
      });
      data.further.forEach((v) => out.push({ type: 'venue', key: v.id, venue: v }));
    }
    return out;
  }, [data, nearbyOnly]);

  const dayOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d, i) => ({
        value: d,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDay(d, { year: false }),
      })),
    [today],
  );
  const dayLabel = dayOptions.find((o) => o.value === day)?.label ?? 'Today';

  const renderItem = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'header')
      return (
        <View style={styles.section}>
          <SectionTitle title={item.title} />
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
        <IconButton icon={Bell} label="Notifications" badge onPress={() => router.push('/notifications')} />
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
        <IconButton icon={SlidersHorizontal} label="Filters" variant="dark" size={size.control} onPress={() => setSheet('filters')} />
      </View>

      <View style={styles.chips}>
        <Chip label={dayLabel} dropdown onPress={() => setSheet('day')} style={styles.chip} />
        <Chip label={format === 'any' ? 'Any format' : format} dropdown onPress={() => setSheet('format')} style={styles.chip} />
        <Chip label="Nearby" icon={MapPin} active={nearbyOnly} onPress={() => setNearbyOnly((v) => !v)} style={styles.chip} />
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Play under the lights. Find a slot for tonight"
        onPress={() => {
          setDay(today);
          setFloodlitOnly(true);
        }}
        style={styles.banner}>
        <Moon size={30} color={colors.lime} fill={colors.lime} strokeWidth={1.5} />
        <View style={styles.bannerRule} />
        <View style={styles.flex}>
          <Text variant="title" color={colors.textOnDark} numberOfLines={1} adjustsFontSizeToFit style={styles.bannerTitle}>
            Play under the lights.
          </Text>
          <Text variant="label" color={colors.textOnDarkMuted}>
            {floodlitOnly ? 'Showing floodlit turfs only' : 'Find a slot for tonight'}
          </Text>
        </View>
        <View style={styles.bannerArrow}>
          <ArrowRight size={20} color={colors.ink} strokeWidth={2.6} />
        </View>
      </PressableScale>
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
              title={nearbyOnly && data?.further.length ? 'Nothing within 5 km' : 'No turfs here yet'}
              body={
                nearbyOnly && data?.further.length
                  ? `There are ${data.further.length} turf${data.further.length > 1 ? 's' : ''} a little further away.`
                  : 'We’re adding venues in new areas every week. Try a different format or location.'
              }
              action={nearbyOnly && data?.further.length ? 'Show all turfs' : 'Clear filters'}
              onAction={() => {
                setNearbyOnly(false);
                if (!(nearbyOnly && data?.further.length)) {
                  setFormat('any');
                  setFloodlitOnly(false);
                }
              }}
            />
          )
        }
      />

      <SideMenu visible={sheet === 'menu'} onClose={() => setSheet(null)} />
      <OptionSheet
        visible={sheet === 'day'}
        title="When do you want to play?"
        options={dayOptions}
        value={day}
        onSelect={setDay}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'format'}
        title="Pitch format"
        options={[...FORMAT_OPTIONS]}
        value={format}
        onSelect={(v) => setFormat(v as PitchFormat | 'any')}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'filters'}
        title="Filters"
        options={[
          { value: 'all', label: 'All turfs' },
          { value: 'floodlit', label: 'Floodlit only', detail: 'For night games' },
        ]}
        value={floodlitOnly ? 'floodlit' : 'all'}
        onSelect={(v) => setFloodlitOnly(v === 'floodlit')}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeName: { maxWidth: 240 },
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, zIndex: 2 },
  place: { alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hero: { height: 205, justifyContent: 'center', marginTop: -space[2] },
  heroImg: { position: 'absolute', right: -50, top: -10, width: 380, height: 215 },
  fadeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '55%' },
  fadeBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  fadeTop: { position: 'absolute', left: 0, right: 0, top: -10, height: 50 },
  heroText: { paddingHorizontal: gutter, gap: space[2] },
  accent: { width: 46, height: 5, borderRadius: 3, backgroundColor: colors.lime },
  display: { marginBottom: space[1] },
  searchRow: { flexDirection: 'row', gap: space[3], paddingHorizontal: gutter, marginTop: space[2] },
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
  chip: { flex: 1, paddingHorizontal: space[3] },
  banner: {
    marginHorizontal: gutter,
    marginTop: space[4],
    height: 84,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[5],
    gap: space[4],
  },
  bannerTitle: { fontFamily: 'Geist_700Bold' },
  bannerRule: { width: 1, height: 40, backgroundColor: colors.borderOnDark },
  bannerArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  section: { paddingHorizontal: gutter, paddingTop: space[6], paddingBottom: space[3] },
  card: { paddingHorizontal: gutter, paddingBottom: space[4] },
  skeletons: { paddingHorizontal: gutter, paddingTop: space[7], gap: space[4] },
});
