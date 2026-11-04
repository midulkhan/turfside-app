import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { addDays, dayOfMonth, weekday, type DayKey } from '@/lib/time';
import { colors, radius, space } from '@/theme/tokens';

import { PressableScale } from './pressable-scale';
import { Text } from './text';
import { haptic } from '@/lib/haptics';

/** Horizontal week strip (Mon 2 · Tue 3 …). Selected day = charcoal tile with lime text. */
export const DateStrip = memo(function DateStrip({
  start,
  days = 14,
  value,
  onChange,
}: {
  start: DayKey;
  days?: number;
  value: DayKey;
  onChange: (d: DayKey) => void;
}) {
  const list = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {list.map((d, i) => {
        const active = d === value;
        return (
          <PressableScale
            key={d}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${weekday(d)} ${dayOfMonth(d)}`}
            onPress={() => {
              haptic.select();
              onChange(d);
            }}
            style={[styles.day, active && styles.active]}>
            <Text variant="label" color={active ? colors.lime : colors.textMuted}>
              {i === 0 ? 'Today' : weekday(d)}
            </Text>
            <Text variant="h3" color={active ? colors.lime : colors.text}>
              {dayOfMonth(d)}
            </Text>
          </PressableScale>
        );
      })}
      <View style={{ width: space[1] }} />
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { gap: space[2], paddingHorizontal: space[5] },
  day: {
    width: 62,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  active: { backgroundColor: colors.ink, borderColor: colors.ink },
});
