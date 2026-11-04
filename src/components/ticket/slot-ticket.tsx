import { Check } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import type { Slot } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { formatRangeSpaced } from '@/lib/time';
import { colors, radius, space } from '@/theme/tokens';

import { TicketDivider, TicketSurface } from './notch';

const TONES = {
  available: { fill: colors.surface, stroke: colors.borderStrong, sw: 1, fg: colors.ink, sub: colors.textMuted, dash: colors.border },
  selected: {
    fill: colors.ink,
    stroke: colors.lime,
    sw: 1.5,
    fg: colors.textOnDark,
    sub: colors.textOnDark,
    dash: 'rgba(255,255,255,0.28)',
  },
  booked: {
    fill: colors.surfaceMuted,
    stroke: colors.border,
    sw: 1,
    fg: colors.textSubtle,
    sub: colors.textSubtle,
    dash: colors.borderStrong,
  },
  blocked: {
    fill: colors.surfaceMuted,
    stroke: colors.border,
    sw: 1,
    fg: colors.textSubtle,
    sub: colors.textSubtle,
    dash: colors.borderStrong,
  },
};

/**
 * Ticket-style time slot: time · tear line (with side notches) · duration or status.
 * Selected = charcoal with a lime outline; booked/unavailable = hatched grey.
 */
export const SlotTicket = memo(function SlotTicket({
  slot,
  selected,
  onPress,
}: {
  slot: Slot;
  selected?: boolean;
  onPress?: (s: Slot) => void;
}) {
  const disabled = slot.status !== 'available';
  const tone = TONES[selected ? 'selected' : slot.status];
  const range = formatRangeSpaced(slot.start, slot.end);
  // Size by length so long ranges ("11:00 PM – 12:00 AM") fit identically on iOS, Android and web.
  const timeSize = range.length <= 15 ? 13.5 : range.length <= 17 ? 12.5 : 11.5;
  const minutes = slot.end - slot.start;
  const status = selected ? 'Selected' : slot.status === 'booked' ? 'Booked' : slot.status === 'blocked' ? 'Unavailable' : `${minutes} min`;

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
        notch={6}
        hatch={disabled}
        style={styles.base}>
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
        <TicketDivider inset={space[3]} gap={7} dashColor={tone.dash} />
        <View style={styles.row}>
          {selected ? (
            <View style={styles.check}>
              <Check size={11} color={colors.ink} strokeWidth={3.5} />
            </View>
          ) : null}
          <Text variant="label" color={tone.sub} numberOfLines={1}>
            {status}
          </Text>
        </View>
      </TicketSurface>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  base: { paddingTop: space[3], paddingBottom: space[3], paddingHorizontal: 4 },
  time: { fontSize: 13.5, letterSpacing: -0.2, fontFamily: 'Geist_700Bold' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  check: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
});
