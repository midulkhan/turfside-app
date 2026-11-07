import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors, radius, size, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

type Variant = 'primary' | 'dark' | 'outline' | 'ghost' | 'light';

const palette = (): Record<Variant, { bg: string; fg: string; border: string; accent: string }> => ({
  primary: { bg: colors.lime, fg: colors.charcoal, border: colors.lime, accent: colors.charcoal },
  dark: { bg: colors.inverse, fg: colors.textOnDark, border: colors.inverse, accent: colors.lime },
  outline: { bg: colors.surface, fg: colors.ink, border: colors.borderStrong, accent: colors.ink },
  light: { bg: colors.surface, fg: colors.ink, border: colors.border, accent: colors.ink },
  ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent', accent: colors.ink },
});

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: LucideIcon; // leading
  trailingIcon?: LucideIcon;
  /** Pushes the trailing icon to the far edge (as in the "View my bookings →" design). */
  spread?: boolean;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  trailingIcon: Trailing,
  spread,
  loading,
  disabled,
  small,
  style,
  accessibilityHint,
}: ButtonProps) {
  const p = palette()[variant];
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[
        styles.base,
        small && styles.small,
        { backgroundColor: p.bg, borderColor: p.border },
        spread && styles.spread,
        disabled && styles.inactive,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.charcoal : p.fg} />
      ) : (
        <>
          {spread ? <View style={styles.spacer} /> : null}
          <View style={styles.row}>
            {Icon ? <Icon size={small ? size.iconSm : size.icon} color={p.fg} strokeWidth={2} /> : null}
            <Text variant={small ? 'labelStrong' : 'bodyStrong'} color={p.fg} style={!small && styles.label}>
              {label}
            </Text>
            {Trailing && !spread ? <Trailing size={size.icon} color={p.accent} strokeWidth={2.2} /> : null}
          </View>
          {spread ? (
            <View style={styles.spacer}>{Trailing ? <Trailing size={size.icon} color={p.accent} strokeWidth={2.2} /> : null}</View>
          ) : null}
        </>
      )}
    </PressableScale>
  );
}

const styles = createStyles(() => ({
  base: {
    height: size.control,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[6],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  small: { height: size.controlSm, paddingHorizontal: space[4] },
  spread: { justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  label: { fontSize: 16.5 },
  spacer: { width: 28, alignItems: 'flex-end' },
  inactive: { opacity: 0.5 },
}));
