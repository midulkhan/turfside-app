import { Check } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import type { Slot } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { formatRangeSpaced } from '@/lib/time';
import { colors, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { TicketDivider, TicketSurface } from './notch';

const TONES = () => ({
  available: { fill: colors.surface, stroke: colors.borderStrong, sw: 1, fg: colors.ink, sub: colors.textMuted, dash: colors.border },
  // The app's active colour (same lime as the chosen date), dark text, in both themes.
  selected: {
    fill: colors.lime,
    stroke: colors.lime,
    sw: 1.5,
    fg: colors.charcoal,
    sub: colors.charcoal,
    dash: 'rgba(22,27,29,0.28)',
  },
  booked: {
    fill: colors.surfaceMuted,
    stroke: colors.border,
    sw: 1,
    fg: colors.textSubtle,
    sub: colors.textSubtle,
    dash: colors.borderStrong,
  },
  // Another player is paying for it right now: warm, clearly "not yours", no hatch.
  held: {
    fill: colors.warningSoft,
    stroke: colors.warningLine,
    sw: 1,
    fg: colors.warningText,
    sub: colors.warningText,
    dash: colors.warningLine,
  },
  // Your own hold (back from checkout): pick it again to continue to checkout.
  blocked: {
    fill: colors.surfaceMuted,
    stroke: colors.border,
    sw: 1,
    fg: colors.textSubtle,
    sub: colors.textSubtle,
    dash: colors.borderStrong,
  },
});

/**
 * Ticket-style time slot: time · tear line (with side notches) · duration or status.
 * Selected = lime with dark text; booked/unavailable = hatched grey.
 */
export const SlotTicket = memo(function SlotTicket({
  slot,
  selected,
  onPress,
  loading,
  reveal,
  pulse,
  index = 0,
}: {
  slot: Slot;
  selected?: boolean;
  onPress?: (s: Slot) => void;
  /** New day still loading: keep the ticket (same size, no remount), show soft placeholder bars. */
  loading?: boolean;
  /** 0→1 when a day's times arrive; each ticket fades its text in a little after the previous one. */
  reveal?: SharedValue<number>;
  /** Shared 0↔1 pulse for the placeholder bars (one clock for the whole grid). */
  pulse?: SharedValue<number>;
  index?: number;
}) {
  const start = Math.min(index, 10) * 0.045;
  // One animated style for both states (an animated style can't be "removed" again on web).
  const textIn = useAnimatedStyle(() => {
    if (loading) return { opacity: 0, transform: [{ translateY: 5 }] };
    if (!reveal) return { opacity: 1, transform: [{ translateY: 0 }] };
    const t = interpolate(reveal.get(), [start, start + 0.5], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ translateY: (1 - t) * 5 }] };
  });
  const barPulse = useAnimatedStyle(() => ({ opacity: pulse ? 0.55 + pulse.get() * 0.45 : 1 }));
  const disabled = loading || slot.status === 'booked' || slot.status === 'blocked' || slot.status === 'held';
  // A slot held for you (e.g. while you're at checkout) is just yours: selected, or free-looking.
  const kind = loading ? 'available' : slot.status === 'mine' ? (selected ? 'selected' : 'available') : selected ? 'selected' : slot.status;
  const tone = TONES()[kind];
  const range = formatRangeSpaced(slot.start, slot.end);
  // Size by length so long ranges ("11:00 PM – 12:00 AM") fit identically on iOS, Android and web.
  const timeSize = range.length <= 15 ? 13.5 : range.length <= 17 ? 12.5 : 11.5;
  const minutes = slot.end - slot.start;
  const status = (
    {
      selected: 'Selected',
      booked: 'Booked',
      blocked: 'Unavailable',
      held: 'Being booked',
      available: `${minutes} min`,
    } as const
  )[kind];

  return (
    <PressableScale
      disabled={disabled}
      scaleTo={0.96}
      onPress={() => {
        haptic.select();
        onPress?.(slot);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${range}, ${status}`}
      accessibilityState={{ disabled, selected: !!selected }}>
      <TicketSurface
        fill={tone.fill}
        stroke={tone.stroke}
        strokeWidth={tone.sw}
        radius={radius.sm}
        notch={8}
        hatch={!loading && (slot.status === 'booked' || slot.status === 'blocked')}
        style={styles.base}>
        {loading ? <Animated.View style={[styles.bar, styles.barTime, barPulse]} /> : null}
        <Animated.View style={textIn}>
          <Text
            variant="labelStrong"
            color={tone.fg}
            style={[styles.time, { fontSize: timeSize }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            align="center">
            {range}
          </Text>
        </Animated.View>
        <TicketDivider inset={space[3] + 2} gap={7} dashColor={tone.dash} />
        {loading ? <Animated.View style={[styles.bar, styles.barSub, barPulse]} /> : null}
        <Animated.View style={[styles.row, textIn]}>
          {kind === 'selected' ? (
            <View style={[styles.check, styles.checkOnLime]}>
              <Check size={11} color={colors.lime} strokeWidth={3.5} />
            </View>
          ) : null}
          <Text variant="label" color={tone.sub} numberOfLines={1}>
            {status}
          </Text>
        </Animated.View>
      </TicketSurface>
    </PressableScale>
  );
});

const styles = createStyles(() => ({
  // Placeholder bars sit exactly where the text lines are; the text stays (invisible) to hold the size.
  bar: { position: 'absolute', alignSelf: 'center', borderRadius: 4, backgroundColor: colors.surfaceMuted },
  barTime: { top: space[3] + 3, width: '62%', height: 12 },
  barSub: { bottom: space[3] + 3, width: '34%', height: 11 },
  base: { paddingTop: space[3], paddingBottom: space[3], paddingHorizontal: 4 },
  time: { fontSize: 13.5, letterSpacing: -0.2, fontFamily: 'Geist_700Bold' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  check: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  checkOnLime: { backgroundColor: colors.charcoal },
}));
