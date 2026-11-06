import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bath,
  CalendarDays,
  Car,
  ChevronDown,
  CircleCheck,
  Coffee,
  FileText,
  GlassWater,
  Heart,
  Lightbulb,
  MapPin,
  Moon,
  Navigation,
  Share2,
  Shirt,
  ShowerHead,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Umbrella,
  UsersRound,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { setStatusBarStyle } from 'expo-status-bar';
import Animated, { Easing, FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SlotTicket } from '@/components/ticket/slot-ticket';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { CalendarModal } from '@/components/ui/calendar';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { haversineKm } from '@/lib/places';
import { qk, useReviews, useSlots, useToggleSaved, useVenue } from '@/features/api/queries';
import { useLiveSlots } from '@/features/api/realtime';
import { ApiError, type Slot, type VenueDetail } from '@/features/api/types';
import { useIsSaved } from '@/features/api/saved-store';
import { useSession } from '@/features/session/session';
import { formatDistance } from '@/lib/geo';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/ids';
import { formatTaka } from '@/lib/money';
import {
  addDays,
  dayOfMonth,
  dayPart,
  dhakaToday,
  formatDay,
  formatDuration,
  formatRangeSpaced,
  monthYear,
  weekday,
  type DayKey,
  type DayPart,
} from '@/lib/time';
import { colors, font, gutter, radius, shadow, space } from '@/theme/tokens';

const DAYS_AHEAD = 60; // booking horizon (server config in production)
const PARTS: { key: DayPart; label: string; icon: LucideIcon }[] = [
  { key: 'morning', label: 'Morning', icon: Sunrise },
  { key: 'afternoon', label: 'Afternoon', icon: Sun },
  { key: 'evening', label: 'Evening', icon: Sunset },
  { key: 'night', label: 'Night', icon: Moon },
];
const HERO_BTN = 40;
const MAX_SLOTS = 6; // per order (the server enforces the same limit)
type Picked = Slot & { day: DayKey };

const AMENITY_ICON: Record<string, LucideIcon> = {
  Floodlights: Lightbulb,
  Parking: Car,
  'Changing room': Shirt,
  'Drinking water': GlassWater,
  Washroom: Bath,
  Showers: ShowerHead,
  Café: Coffee,
  Roof: Umbrella,
};
type Tab = 'book' | 'details' | 'reviews';

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { place } = useSession();
  const qc = useQueryClient();
  const today = dhakaToday();

  const [day, setDay] = useState<DayKey>(today);
  // Picked slots, kept across day changes (one order can span days at this turf).
  const [picked, setPicked] = useState<Picked[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [tab, setTab] = useState<Tab>('book');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const holdKey = useRef<string | null>(null);
  const dateScroll = useRef<ScrollViewInstance>(null);
  const galleryRef = useRef<ComponentRef<typeof View>>(null); // Android: what the photo buttons blur

  const venue = useVenue(id);
  const live = useLiveSlots(id, day); // instant updates when someone else holds or books
  const slots = useSlots(id, day, live);
  const reviews = useReviews(id, tab === 'reviews');
  const toggle = useToggleSaved();
  const v = venue.data;
  const isSaved = useIsSaved(id, !!v?.isSaved);

  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);

  const grouped = useMemo(() => {
    const g: Record<DayPart, Slot[]> = { morning: [], afternoon: [], evening: [], night: [] };
    slots.data?.slots.forEach((s) => g[dayPart(s.start)].push(s));
    return g;
  }, [slots.data]);

  // Drop picks on the day in view that someone else just took (others are re-checked by the server).
  // Your own hold counts as selectable: continuing with the same slots resumes it.
  const chosen = useMemo(
    () =>
      picked.filter((p) => {
        if (p.day !== day || !slots.data) return true;
        const live = slots.data.slots.find((s) => s.id === p.id);
        return !!live && (live.status === 'available' || live.status === 'mine');
      }),
    [picked, day, slots.data],
  );
  const chosenIds = useMemo(() => new Set(chosen.map((p) => p.id)), [chosen]);
  const togglePick = (s: Slot) =>
    setPicked((cur) => {
      if (cur.some((p) => p.id === s.id)) return cur.filter((p) => p.id !== s.id);
      if (cur.length >= MAX_SLOTS) {
        haptic.error();
        Alert.alert('That’s the maximum', `You can book up to ${MAX_SLOTS} slots in one go.`);
        return cur;
      }
      // The slot's own id carries its date (`venue:YYYY-MM-DD:start`), never the date strip's state.
      return [...cur, { ...s, day: (s.id.split(':')[1] as DayKey) ?? day }];
    });
  const distance = v ? formatDistance(haversineKm(place.lat, place.lng, v.latitude, v.longitude)) : '';

  const hold = useMutation({
    mutationFn: (list: Picked[]) => {
      holdKey.current ??= newIdempotencyKey();
      return api.createHold(
        list.map((p) => p.id),
        holdKey.current,
      );
    },
    onSuccess: (h) => {
      holdKey.current = null;
      qc.setQueryData(qk.hold(h.holdId), h);
      qc.invalidateQueries({ queryKey: qk.myHolds });
      qc.invalidateQueries({ queryKey: ['slots'] }); // this cart's slots (and any cart it replaced) refresh everywhere
      router.push({ pathname: '/checkout', params: { holdId: h.holdId } });
    },
    onError: (e) => {
      holdKey.current = null;
      haptic.error();
      Alert.alert(e instanceof ApiError && e.code === 'slot_taken' ? 'Slot just got taken' : 'Could not hold these slots', e.message);
      setPicked([]);
      slots.refetch();
    },
  });

  const pickDay = (d: DayKey) => setDay(d);

  const heroH = Math.round(width * 0.68) + insets.top * 0.4;
  // Header goes white (and shows the name) once the photo has scrolled under it.
  const scrolled = useScrolled(heroH - insets.top - HERO_BTN - space[4]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: scrolled.progress.get() }));
  // Light status bar over the photo, dark once the header turns white; only while this
  // screen is in front, and always back to dark when leaving (checkout is white).
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(scrolled.isScrolled ? 'dark' : 'light', true);
      return () => setStatusBarStyle('dark', true);
    }, [scrolled.isScrolled]),
  );

  if (venue.isError) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space[8] }]}>
        <ErrorState message={venue.error.message} onRetry={venue.refetch} />
      </View>
    );
  }

  const gallery = v?.photos.length ? v.photos : [null];
  const btnVariant = scrolled.isScrolled ? 'light' : 'blur';
  const openMap = () => v && Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`);

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        {/* ── Gallery ─────────────────────────────────────────── */}
        <View style={[styles.hero, { height: heroH }]}>
          <BlurTargetView ref={galleryRef} style={StyleSheet.absoluteFill}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhotoIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
              {gallery.map((p, i) => (
                <Photo key={i} source={p} style={{ width, height: heroH }} rounded={0} priority={i === 0 ? 'high' : 'low'} />
              ))}
            </ScrollView>
          </BlurTargetView>
          <View style={styles.counter}>
            {Platform.OS === 'ios' ? (
              <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
            ) : Platform.OS === 'android' && Number(Platform.Version) >= 31 ? (
              <BlurView intensity={30} tint="dark" blurTarget={galleryRef} blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            ) : null}
            <Text variant="caption" color={colors.textOnDark}>
              {photoIndex + 1} / {gallery.length}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* ── Title block ─────────────────────────────────────── */}
          {v ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.titleBlock}>
              <Text variant="overline" color={colors.limeText}>
                {`FOOTBALL · ${v.formats.join(' / ').toUpperCase()}`}
              </Text>
              <Text variant="h2" style={styles.name} numberOfLines={2}>
                {v.name}
              </Text>
              {v.reviewCount > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => setTab('reviews')} style={styles.row} hitSlop={6}>
                  <Star size={18} color="#F5B301" fill="#F5B301" />
                  <Text variant="bodyStrong">{v.rating.toFixed(1)}</Text>
                  <Text variant="body" color={colors.textMuted} style={styles.underline}>
                    ({v.reviewCount} reviews)
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.addressRow}>
                <MapPin size={16} color={colors.textMuted} strokeWidth={1.7} />
                <Text variant="body" color={colors.textMuted} style={[styles.flex, styles.address]} numberOfLines={1}>
                  {v.shortAddress} · {distance} away
                </Text>
                <Pressable accessibilityRole="link" onPress={openMap} hitSlop={8} style={styles.mapLink}>
                  <Text variant="labelStrong">Map</Text>
                  <ArrowUpRight size={16} color={colors.ink} strokeWidth={2.2} />
                </Pressable>
              </View>
            </Animated.View>
          ) : (
            <View style={styles.titleBlock}>
              <Skeleton width={120} height={12} />
              <Skeleton width="70%" height={28} />
              <Skeleton width="45%" height={16} />
              <Skeleton width="80%" height={16} />
            </View>
          )}

          {/* ── Amenities strip ─────────────────────────────────── */}
          {v ? <AmenityStrip v={v} /> : <Skeleton height={84} r={radius.lg} />}

          {/* ── Tabs ────────────────────────────────────────────── */}
          <View style={styles.tabs} accessibilityRole="tablist">
            {(
              [
                ['book', 'Book a slot'],
                ['details', 'Details'],
                ['reviews', 'Reviews'],
              ] as const
            )
              // No reviews yet: no Reviews tab.
              .filter(([key]) => key !== 'reviews' || (v?.reviewCount ?? 0) > 0)
              .map(([key, label]) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      haptic.select();
                      setTab(key);
                    }}
                    style={styles.tab}>
                    <Text variant={active ? 'bodyStrong' : 'body'} color={active ? colors.text : colors.textMuted}>
                      {label}
                    </Text>
                    {active ? (
                      <Animated.View layout={LinearTransition.duration(200)} style={styles.tabLine} />
                    ) : (
                      <View style={styles.tabLineOff} />
                    )}
                  </Pressable>
                );
              })}
          </View>

          {tab === 'book' ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.gap}>
              <Card style={styles.bookCard}>
                {/* Select date */}
                <View style={styles.cardHead}>
                  <Text variant="title">Select date</Text>
                  <Pressable accessibilityRole="button" onPress={() => setCalendarOpen(true)} style={styles.monthBtn} hitSlop={6}>
                    <CalendarDays size={18} color={colors.ink} strokeWidth={1.8} />
                    <Text variant="label">{monthYear(day)}</Text>
                    <ChevronDown size={16} color={colors.ink} strokeWidth={2.2} />
                  </Pressable>
                </View>
                <ScrollView ref={dateScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates}>
                  {days.map((d) => {
                    const active = d === day;
                    return (
                      <PressableScale
                        key={d}
                        scaleTo={0.94}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={formatDay(d)}
                        onPress={() => {
                          haptic.select();
                          pickDay(d);
                        }}
                        style={[styles.date, active && styles.dateOn]}>
                        <Text variant="label" color={active ? colors.ink : colors.textMuted}>
                          {weekday(d)}
                        </Text>
                        <Text variant="bodyStrong" color={colors.ink} style={styles.dateNum}>
                          {String(dayOfMonth(d)).padStart(2, '0')}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>

                {/* Choose a time */}
                <View style={[styles.cardHead, styles.mtLg]}>
                  <Text variant="title">Choose a time</Text>
                  {v ? (
                    <Text variant="label" color={colors.textMuted}>
                      {v.sessionLengthMin} min each
                    </Text>
                  ) : null}
                </View>

                {slots.isPending || slots.isPlaceholderData ? (
                  <View style={styles.skeletonGrid}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} width="47%" height={72} r={radius.sm} />
                    ))}
                  </View>
                ) : slots.isError ? (
                  <ErrorState message={slots.error.message} onRetry={slots.refetch} />
                ) : (
                  <Timeline grouped={grouped} selectedIds={chosenIds} onPick={togglePick} />
                )}
                {slots.data && !slots.isPlaceholderData && !slots.data.slots.some((s) => s.status === 'available' || s.status === 'mine') ? (
                  <Text variant="label" color={colors.textMuted} style={styles.mtSm}>
                    No open sessions on this day. Try another date.
                  </Text>
                ) : null}
                <Text variant="caption" color={colors.textMuted} style={styles.mtSm}>
                  Times shown in Dhaka time. Slots after 12 AM fall on the next calendar day.
                </Text>
              </Card>

              {/* Rules accordion */}
              <Animated.View layout={LinearTransition.duration(200)}>
                <Card padded={false}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: rulesOpen }}
                    onPress={() => setRulesOpen((o) => !o)}
                    style={styles.accordionHead}>
                    <FileText size={22} color={colors.ink} strokeWidth={1.6} />
                    <Text variant="body" style={styles.flex}>
                      Venue rules & cancellation
                    </Text>
                    <ChevronDown size={20} color={colors.ink} style={rulesOpen ? styles.flip : undefined} />
                  </Pressable>
                  {rulesOpen && v ? (
                    <Animated.View entering={FadeIn.duration(180)} style={styles.accordionBody}>
                      {v.rules.map((r) => (
                        <View key={r} style={styles.ruleRow}>
                          <CircleCheck size={16} color={colors.limeText} />
                          <Text variant="label" color={colors.textMuted} style={styles.flex}>
                            {r}
                          </Text>
                        </View>
                      ))}
                      <Divider style={styles.divider} />
                      <Text variant="labelStrong">Cancellation</Text>
                      <Text variant="label" color={colors.textMuted}>
                        {v.cancellationPolicy}
                      </Text>
                    </Animated.View>
                  ) : null}
                </Card>
              </Animated.View>
            </Animated.View>
          ) : tab === 'details' && v ? (
            <Animated.View entering={FadeIn.duration(160)}>
              <DetailsTab v={v} onDirections={openMap} />
            </Animated.View>
          ) : tab === 'reviews' ? (
            <Animated.View entering={FadeIn.duration(160)}>
              <ReviewsTab data={reviews.data} loading={reviews.isPending} />
            </Animated.View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky header: transparent over the photo, white with the name once scrolled. */}
      <StickyHeader progress={scrolled.progress} from="rgba(255,255,255,0)" floating style={styles.stickyBar}>
        <View style={styles.heroBar}>
          <IconButton
            icon={ArrowLeft}
            label="Go back"
            variant={btnVariant}
            blurTarget={galleryRef}
            size={HERO_BTN}
            onPress={() => router.back()}
          />
          <Animated.View style={[styles.barTitle, titleStyle]} pointerEvents="none">
            <Text variant="title" numberOfLines={1} align="center">
              {v?.name ?? ''}
            </Text>
          </Animated.View>
          <View style={styles.row}>
            <IconButton
              icon={Share2}
              label="Share turf"
              variant={btnVariant}
              blurTarget={galleryRef}
              size={HERO_BTN}
              onPress={() => v && Share.share({ message: `${v.name}, ${v.area} — book on TurfSides: https://turfsides.app/v/${v.id}` })}
            />
            <IconButton
              icon={Heart}
              label={isSaved ? 'Remove from saved' : 'Save turf'}
              variant={btnVariant}
              blurTarget={galleryRef}
              size={HERO_BTN}
              fill={isSaved ? colors.danger : undefined}
              iconColor={isSaved ? colors.danger : undefined}
              onPress={() => {
                if (!v) return;
                haptic.select();
                toggle.mutate({ venueId: v.id, value: !isSaved });
              }}
            />
          </View>
        </View>
      </StickyHeader>

      {/* ── Price bar: slides up only once a slot is picked ───── */}
      <PriceBar picks={chosen} bottomInset={insets.bottom} loading={hold.isPending} onContinue={() => chosen.length && hold.mutate(chosen)} />

      <CalendarModal
        visible={calendarOpen}
        title="Select date"
        value={[day]}
        min={today}
        max={days[days.length - 1]}
        onConfirm={([d]) => {
          if (!d) return;
          pickDay(d);
          const index = days.indexOf(d);
          requestAnimationFrame(() => dateScroll.current?.scrollTo({ x: Math.max(0, index * 74 - 8), animated: true }));
        }}
        onClose={() => setCalendarOpen(false)}
      />
    </View>
  );
}

/** Compact dark bar. Keeps showing the last picks while it slides away, so it never blanks mid-animation. */
function PriceBar({
  picks,
  bottomInset,
  loading,
  onContinue,
}: {
  picks: Picked[];
  bottomInset: number;
  loading: boolean;
  onContinue: () => void;
}) {
  const open = picks.length > 0;
  const [last, setLast] = useState<Picked[]>(picks);
  if (open && picks !== last) setLast(picks);
  const shown = open ? picks : last;
  const visible = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    visible.set(
      withTiming(open ? 1 : 0, { duration: open ? 300 : 220, easing: open ? Easing.bezier(0.22, 1, 0.36, 1) : Easing.in(Easing.quad) }),
    );
  }, [open, visible]);
  const anim = useAnimatedStyle(() => ({
    opacity: visible.get(),
    transform: [{ translateY: (1 - visible.get()) * 120 }],
  }));
  const one = shown.length === 1 ? shown[0] : null;
  const days = [...new Set(shown.map((p) => p.day))].sort();
  const minutes = shown.reduce((n, p) => n + (p.end - p.start), 0);
  const summary = one
    ? `${formatDay(one.day, { year: false })}  ·  ${formatRangeSpaced(one.start, one.end)}`
    : `${shown.length} slots  ·  ${days.length === 1 ? formatDay(days[0], { year: false }) : `${days.length} days`}`;
  return (
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.priceWrap, { bottom: Math.max(bottomInset, space[3]) }, anim]}>
      <View style={[styles.priceBar, shadow.float]}>
        <View style={styles.priceText}>
          <Text variant="caption" color={colors.textOnDarkMuted} numberOfLines={1}>
            {shown.length ? summary : ''}
          </Text>
          <Text variant="h3" color={colors.textOnDark} style={styles.price}>
            {shown.length ? formatTaka(shown.reduce((n, p) => n + p.price, 0)) : ''}
            <Text variant="caption" color={colors.textOnDarkMuted}>
              {shown.length ? `   ${formatDuration(minutes)}` : ''}
            </Text>
          </Text>
        </View>
        <Button label="Continue" trailingIcon={ArrowRight} small loading={loading} onPress={onContinue} style={styles.continue} />
      </View>
    </Animated.View>
  );
}

/* ── Pieces ─────────────────────────────────────────────────── */

function AmenityStrip({ v }: { v: VenueDetail }) {
  const items: { icon: LucideIcon; label: string }[] = [
    { icon: UsersRound, label: v.formats[0] },
    ...v.amenities
      .filter((a) => AMENITY_ICON[a])
      .slice(0, 3)
      .map((a) => ({ icon: AMENITY_ICON[a], label: a })),
  ];
  return (
    <Card padded={false} style={styles.strip}>
      {items.map((it, i) => (
        <View key={it.label} style={[styles.stripItem, i > 0 && styles.stripDivider]}>
          <it.icon size={20} color={colors.ink} strokeWidth={1.4} />
          <Text variant="body" color={colors.textMuted} numberOfLines={2} align="center" style={styles.stripLabel}>
            {it.label}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** Time picker grouped by part of day, with a vertical timeline on the left. */
function Timeline({ grouped, selectedIds, onPick }: { grouped: Record<DayPart, Slot[]>; selectedIds: Set<string>; onPick: (s: Slot) => void }) {
  const parts = PARTS.filter((p) => grouped[p.key].length);
  return (
    <View>
      {parts.map((p, i) => {
        const active = grouped[p.key].some((s) => selectedIds.has(s.id));
        const first = i === 0;
        const last = i === parts.length - 1;
        return (
          <View key={p.key} style={styles.partRow}>
            {/* Narrow rail: one continuous line, the period's icon + name sit on it (line breaks around them). */}
            <View style={styles.rail}>
              <View style={[styles.railLine, first && styles.railFirst, last && styles.railLast]} />
              <View style={styles.partLabel}>
                <p.icon size={20} color={active ? colors.limeText : colors.ink} strokeWidth={1.6} />
                <Text variant="caption" color={active ? colors.limeText : colors.textMuted} numberOfLines={1} style={styles.partText}>
                  {p.label}
                </Text>
              </View>
            </View>
            <View style={styles.slotGrid}>
              {grouped[p.key].map((s) => (
                <View key={s.id} style={styles.slotCell}>
                  <SlotTicket slot={s} selected={selectedIds.has(s.id)} onPress={onPick} />
                </View>
              ))}
              {grouped[p.key].length % 2 ? <View style={styles.slotCell} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DetailsTab({ v, onDirections }: { v: VenueDetail; onDirections: () => void }) {
  return (
    <View style={styles.gap}>
      <Card style={styles.gapSm}>
        <Text variant="title">About</Text>
        <Text variant="body" color={colors.textMuted}>
          {v.about}
        </Text>
        <View style={[styles.row, styles.mtSm]}>
          <CalendarDays size={18} color={colors.ink} strokeWidth={1.8} />
          <Text variant="label">{v.openingHours}</Text>
        </View>
      </Card>
      <Card style={styles.gapSm}>
        <Text variant="title">Amenities</Text>
        <View style={styles.amenityGrid}>
          {v.amenities.map((a) => {
            const Icon = AMENITY_ICON[a] ?? CircleCheck;
            return (
              <View key={a} style={styles.amenity}>
                <Icon size={18} color={colors.ink} strokeWidth={1.7} />
                <Text variant="label">{a}</Text>
              </View>
            );
          })}
        </View>
      </Card>
      <Card style={styles.locCard}>
        <View style={styles.locIcon}>
          <MapPin size={22} color={colors.ink} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <Text variant="labelStrong">Location</Text>
          <Text variant="label" color={colors.textMuted} numberOfLines={2}>
            {v.address}
          </Text>
        </View>
        <Button label="Directions" icon={Navigation} variant="outline" small onPress={onDirections} />
      </Card>
    </View>
  );
}

function ReviewsTab({ data, loading }: { data?: Awaited<ReturnType<typeof api.getReviews>>; loading: boolean }) {
  const [now] = useState(() => Date.now());
  if (loading || !data) return <Skeleton height={180} r={radius.lg} />;
  const max = Math.max(...Object.values(data.histogram), 1);
  return (
    <View style={styles.gap}>
      <Card style={styles.summary}>
        <View style={styles.summaryLeft}>
          <Text variant="number" style={styles.bigRating}>
            {data.average.toFixed(1)}
          </Text>
          <View style={styles.row}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={14} color="#F5B301" fill={i < Math.round(data.average) ? '#F5B301' : 'transparent'} />
            ))}
          </View>
          <Text variant="caption" color={colors.textMuted}>
            {data.count} reviews
          </Text>
        </View>
        <View style={styles.flex}>
          {([5, 4, 3, 2, 1] as const).map((n) => (
            <View key={n} style={styles.histRow}>
              <Text variant="caption" color={colors.textMuted} style={styles.histLabel}>
                {n}
              </Text>
              <View style={styles.histTrack}>
                <View style={[styles.histFill, { width: `${(data.histogram[n] / max) * 100}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </Card>
      {data.items.map((r) => (
        <Card key={r.id} style={styles.gapSm}>
          <View style={styles.row}>
            <Avatar name={r.author} size={36} />
            <View style={styles.flex}>
              <Text variant="labelStrong">{r.author}</Text>
              <Text variant="caption" color={colors.textMuted}>
                {Math.round((now - r.at) / 86400_000)} days ago · played here
              </Text>
            </View>
            <View style={styles.row}>
              <Star size={14} color="#F5B301" fill="#F5B301" />
              <Text variant="labelStrong">{r.rating}</Text>
            </View>
          </View>
          <Text variant="label" color={colors.textMuted}>
            {r.text}
          </Text>
        </Card>
      ))}
      <Text variant="caption" color={colors.textMuted} align="center">
        Only players who completed a booking can leave a review.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  gap: { gap: space[3] },
  gapSm: { gap: space[2] },
  mtSm: { marginTop: space[3] },
  mtLg: { marginTop: space[5] },
  underline: { textDecorationLine: 'underline' },

  hero: {
    borderBottomLeftRadius: radius.xl + 8,
    borderBottomRightRadius: radius.xl + 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  stickyBar: { paddingHorizontal: gutter, paddingBottom: space[2] },
  heroBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingTop: space[2] },
  barTitle: { flex: 1 },
  counter: {
    position: 'absolute',
    right: space[5],
    bottom: space[4],
    backgroundColor: 'rgba(22,27,29,0.32)',
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: space[3],
    height: 26,
    justifyContent: 'center',
  },

  body: { paddingHorizontal: gutter, paddingTop: space[5], gap: space[4] },
  titleBlock: { gap: space[2] },
  name: { fontFamily: font.semibold, fontSize: 21, lineHeight: 26, letterSpacing: -0.4 },
  address: { fontSize: 13.5, lineHeight: 18 },
  dateNum: { fontSize: 16, lineHeight: 20 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: space[2] },

  strip: { flexDirection: 'row', paddingVertical: space[4] },
  // equal columns, equal inner padding: long labels wrap instead of touching the dividers
  stripItem: { flex: 1, flexBasis: 0, alignItems: 'center', gap: 6, paddingHorizontal: space[2] },
  stripLabel: { fontSize: 11.5, lineHeight: 14 },
  stripDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },

  tabs: { flexDirection: 'row', gap: space[6], borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: space[1] },
  tab: { paddingTop: space[2], gap: space[2], alignItems: 'flex-start' },
  tabLine: { height: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.lime, marginBottom: -1 },
  tabLineOff: { height: 3, marginBottom: -1 },

  bookCard: { paddingVertical: space[4], paddingHorizontal: space[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  monthBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  dates: { gap: space[2] },
  date: {
    width: 66,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateOn: { backgroundColor: colors.lime, borderColor: colors.lime },

  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'space-between' },
  partRow: { flexDirection: 'row' },
  rail: { width: 62, alignItems: 'center', justifyContent: 'center', marginRight: space[2], paddingBottom: space[2] },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border },
  railFirst: { top: space[2] },
  railLast: { bottom: space[4] },
  // Card-coloured backing so the line visibly breaks around the icon and name.
  partLabel: { alignItems: 'center', gap: 4, paddingVertical: space[2], backgroundColor: colors.surface },
  partText: { fontSize: 11.5, lineHeight: 14 },
  // No negative margins: Android clips anything that pokes outside its parent (that cut the tickets' right borders).
  slotGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: space[2] },
  slotCell: { flexBasis: '40%', flexGrow: 1 },

  accordionHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], minHeight: 60 },
  accordionBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[2] },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flip: { transform: [{ rotate: '180deg' }] },
  divider: { marginVertical: space[2] },

  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  amenity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    height: 36,
  },
  locCard: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  locIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },

  summary: { flexDirection: 'row', gap: space[5], alignItems: 'center' },
  summaryLeft: { alignItems: 'center', gap: 4 },
  bigRating: { fontSize: 34, lineHeight: 38 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], height: 18 },
  histLabel: { width: 10 },
  histTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  histFill: { height: '100%', backgroundColor: '#F5B301', borderRadius: 3 },

  priceWrap: { position: 'absolute', left: space[4], right: space[4] },
  priceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingLeft: space[6],
    paddingRight: 8,
    height: 68,
    gap: space[3],
  },
  priceText: { flex: 1, gap: 3 },
  price: { fontSize: 18, lineHeight: 22 },
  continue: { minWidth: 136, height: 52 },
});
