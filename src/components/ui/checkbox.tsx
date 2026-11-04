import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme/tokens';

export function Checkbox({
  checked,
  onChange,
  children,
  tone = 'light',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  tone?: 'light' | 'dark';
}) {
  const border = tone === 'dark' ? colors.textOnDarkMuted : colors.borderStrong;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        haptic.select();
        onChange(!checked);
      }}
      hitSlop={6}
      style={styles.row}>
      <View style={[styles.box, { borderColor: checked ? colors.lime : border }, checked && styles.on]}>
        {checked ? <Check size={16} color={colors.ink} strokeWidth={3} /> : null}
      </View>
      <View style={styles.label}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: radius.xs - 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.lime },
  label: { flex: 1 },
});
