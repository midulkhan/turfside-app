import { ChevronDown, type LucideIcon } from 'lucide-react-native';
import { type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from '@/lib/haptics';
import { colors, radius, size, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

type Props = {
  label: string;
  active?: boolean;
  icon?: LucideIcon;
  dropdown?: boolean;
  onPress?: () => void;
  tone?: 'lime' | 'dark';
  style?: StyleProp<ViewStyle>;
};

/** Pill filter / choice chip. Active = lime (filters) or dark (segmented choices). */
export function Chip({ label, active, icon: Icon, dropdown, onPress, tone = 'lime', style }: Props) {
  const activeBg = tone === 'lime' ? colors.lime : colors.inverse;
  const activeFg = tone === 'lime' ? colors.charcoal : colors.lime;
  const fg = active ? activeFg : colors.ink;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      style={[
        styles.base,
        active ? { backgroundColor: activeBg, borderColor: activeBg } : { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}>
      {Icon ? <Icon size={size.iconSm} color={fg} strokeWidth={2} /> : null}
      <Text variant="labelStrong" color={fg} numberOfLines={1}>
        {label}
      </Text>
      {dropdown ? <ChevronDown size={16} color={fg} strokeWidth={2.2} /> : null}
    </PressableScale>
  );
}

const styles = createStyles(() => ({
  base: {
    minHeight: size.controlSm,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
}));
