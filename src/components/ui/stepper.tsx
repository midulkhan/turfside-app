import { Check } from 'lucide-react-native';
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Text } from './text';

/** 01 Select slot —— 02 Review & pay —— 03 Confirmed */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            {i > 0 ? <View style={[styles.line, done || active ? styles.lineOn : null]} /> : null}
            <View style={styles.step}>
              <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
                {done ? (
                  <Check size={14} color={colors.ink} strokeWidth={3} />
                ) : (
                  <Text variant="caption" color={active ? colors.lime : colors.textMuted} style={styles.num}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                )}
              </View>
              <Text
                variant="caption"
                color={active ? colors.text : colors.textMuted}
                numberOfLines={1}
                style={active ? styles.labelActive : null}>
                {label}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  labelActive: { fontFamily: 'Geist_700Bold' },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  dotDone: { backgroundColor: colors.lime, borderColor: colors.lime },
  dotActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  num: { fontFamily: 'Geist_700Bold' },
  line: { flex: 1, minWidth: 8, height: 1, backgroundColor: colors.borderStrong },
  lineOn: { backgroundColor: colors.ink },
});
