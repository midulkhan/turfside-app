import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowUpRight, Heart, Lightbulb, Star, UsersRound } from 'lucide-react-native';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Card, Divider } from '@/components/ui/card';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { prefetchVenue, useToggleSaved } from '@/features/api/queries';
import { useIsSaved } from '@/features/api/saved-store';
import type { VenueSummary } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { formatDistance } from '@/lib/geo';
import { formatTaka } from '@/lib/money';
import { colors, radius, space } from '@/theme/tokens';

/** Founder-approved venue card. Memoised: list re-renders skip unchanged cards. */
export const VenueCard = memo(function VenueCard({ venue }: { venue: VenueSummary }) {
  const qc = useQueryClient();
  const toggle = useToggleSaved();
  const saved = useIsSaved(venue.id, venue.isSaved);
  const open = () => router.push({ pathname: '/venue/[id]', params: { id: venue.id } });

  return (
    <View>
      <PressableScale
        scaleTo={0.985}
        onPressIn={() => prefetchVenue(qc, venue)}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${venue.name}, ${venue.area}, ${formatTaka(venue.hourlyFrom)} per hour`}>
        <Card padded={false} elevated style={styles.card}>
          <View>
            <Photo source={venue.photo} style={styles.photo} recyclingKey={venue.id} />
            {venue.reviewCount > 0 ? (
              <View style={styles.rating}>
                <Star size={16} color="#F5B301" fill="#F5B301" />
                <Text variant="labelStrong">{venue.rating.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <View style={styles.flex}>
                <Text variant="h3" numberOfLines={1}>
                  {venue.name}
                </Text>
                <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                  {venue.area}
                  {venue.distanceKm != null ? ` · ${formatDistance(venue.distanceKm)}` : ''}
                </Text>
              </View>
              <View style={styles.price}>
                <Text variant="h3">{formatTaka(venue.hourlyFrom)}</Text>
                <Text variant="caption" color={colors.textMuted}>
                  / hour
                </Text>
              </View>
            </View>
            <View style={styles.tags}>
              <View style={styles.tag}>
                <UsersRound size={16} color={colors.textMuted} strokeWidth={1.8} />
                <Text variant="label" color={colors.textMuted}>
                  {venue.formats[0]}
                </Text>
              </View>
              {venue.floodlit ? (
                <>
                  <View style={styles.dot} />
                  <View style={styles.tag}>
                    <Lightbulb size={16} color={colors.textMuted} strokeWidth={1.8} />
                    <Text variant="label" color={colors.textMuted}>
                      Floodlights
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
            <Divider />
            <View style={styles.footer}>
              <View style={styles.tag}>
                {venue.availableToday ? <LiveDot /> : <View style={[styles.avail, styles.availOff]} />}
                <Text variant="labelStrong" color={venue.availableToday ? colors.text : colors.textMuted}>
                  {venue.availableToday ? 'Available today' : 'Fully booked today'}
                </Text>
              </View>
              <View style={styles.cta}>
                <Text variant="labelStrong" color={colors.textOnDark}>
                  View slots
                </Text>
                <ArrowUpRight size={16} color={colors.textOnDark} strokeWidth={2.2} />
              </View>
            </View>
          </View>
        </Card>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save turf'}
        accessibilityState={{ selected: saved }}
        hitSlop={8}
        scaleTo={0.85}
        onPress={() => {
          haptic.select();
          toggle.mutate({ venueId: venue.id, value: !saved });
        }}
        style={styles.heart}>
        <Heart size={20} color={saved ? colors.danger : colors.ink} fill={saved ? colors.danger : 'transparent'} strokeWidth={2} />
      </PressableScale>
    </View>
  );
});

/** "Available today" dot: a soft heartbeat, run on the UI thread. */
function LiveDot() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), -1, false));
  }, [t]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - t.get()), transform: [{ scale: 1 + t.get() * 1.4 }] }));
  const core = useAnimatedStyle(() => ({ opacity: t.get() < 0.5 ? 1 : 0.55 + 0.45 * Math.abs(Math.cos(t.get() * Math.PI)) }));
  return (
    <View style={styles.liveWrap} accessibilityElementsHidden importantForAccessibility="no">
      <Animated.View style={[styles.liveRing, ring]} />
      <Animated.View style={[styles.avail, core]} />
    </View>
  );
}

const styles = StyleSheet.create({
  liveWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  liveRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: '#A8D52B' },
  card: { padding: 6 },
  photo: { width: '100%', aspectRatio: 16 / 7.4 },
  rating: {
    position: 'absolute',
    top: space[3],
    left: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: radius.pill,
  },
  heart: {
    position: 'absolute',
    top: space[3] + 6,
    right: space[3] + 6,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2], gap: space[3] },
  titleRow: { flexDirection: 'row', gap: space[3] },
  flex: { flex: 1, gap: 2 },
  price: { alignItems: 'flex-end' },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avail: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#A8D52B', borderWidth: 2, borderColor: colors.limeTint },
  availOff: { backgroundColor: colors.borderStrong, borderColor: colors.surfaceMuted },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ink,
    height: 40,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
  },
});
