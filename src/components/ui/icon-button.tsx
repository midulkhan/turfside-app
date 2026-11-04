import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, size } from '@/theme/tokens';

import { PressableScale } from './pressable-scale';

type Props = {
  icon: LucideIcon;
  label: string; // accessibility label, required
  onPress?: () => void;
  variant?: 'light' | 'dark' | 'glass' | 'lime';
  badge?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const tones = {
  light: { bg: colors.surface, fg: colors.ink, border: colors.border },
  dark: { bg: colors.ink, fg: colors.textOnDark, border: colors.ink },
  glass: { bg: colors.glass, fg: colors.ink, border: 'rgba(255,255,255,0.6)' },
  lime: { bg: colors.lime, fg: colors.ink, border: colors.lime },
};

export function IconButton({ icon: Icon, label, onPress, variant = 'light', badge, size: s = size.iconButton, style }: Props) {
  const t = tones[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      scaleTo={0.92}
      style={[styles.base, { width: s, height: s, backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Icon size={size.icon} color={t.fg} strokeWidth={2} />
      {badge ? <View style={styles.badge} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
