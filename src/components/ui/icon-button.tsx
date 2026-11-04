import { BlurView } from 'expo-blur';
import type { LucideIcon } from 'lucide-react-native';
import type { ComponentRef, RefObject } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, size } from '@/theme/tokens';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

type Props = {
  icon: LucideIcon;
  label: string; // accessibility label, required
  onPress?: () => void;
  /** 'blur' = frosted glass over photos. On Android pass `blurTarget` (a BlurTargetView ref behind it). */
  variant?: 'light' | 'dark' | 'glass' | 'lime' | 'blur';
  blurTarget?: RefObject<ComponentRef<typeof View> | null>;
  /** Fill the icon (e.g. a saved heart). */
  fill?: string;
  iconColor?: string;
  badge?: boolean;
  /** Small count bubble (e.g. items in the cart). Hidden at 0. */
  count?: number;
  /** Dimmed and not pressable (e.g. an empty cart). */
  disabled?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const tones = {
  light: { bg: colors.surface, fg: colors.ink, border: colors.border },
  dark: { bg: colors.ink, fg: colors.textOnDark, border: colors.ink },
  glass: { bg: colors.glass, fg: colors.ink, border: 'rgba(255,255,255,0.6)' },
  lime: { bg: colors.lime, fg: colors.ink, border: colors.lime },
  blur: { bg: 'transparent', fg: colors.ink, border: 'rgba(255,255,255,0.55)' },
};

const androidBlur = Platform.OS === 'android' && Number(Platform.Version) >= 31;

export function IconButton({
  icon: Icon,
  label,
  onPress,
  variant = 'light',
  blurTarget,
  fill,
  iconColor,
  badge,
  count,
  disabled,
  size: s = size.iconButton,
  style,
}: Props) {
  const t = tones[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.92}
      style={[styles.base, { width: s, height: s, backgroundColor: t.bg, borderColor: t.border }, disabled && styles.disabled, style]}>
      {variant === 'blur' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.blurClip, { borderRadius: s / 2 }]}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />
          ) : androidBlur && blurTarget ? (
            <BlurView intensity={30} tint="light" blurTarget={blurTarget} blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          ) : null}
          <View style={[StyleSheet.absoluteFill, styles.blurTint]} />
        </View>
      ) : null}
      <View style={styles.iconLayer}>
        <Icon size={s < 44 ? 18 : size.icon} color={iconColor ?? t.fg} fill={fill ?? 'transparent'} strokeWidth={2} />
      </View>
      {badge ? <View style={styles.badge} /> : null}
      {count ? (
        <View style={styles.count}>
          <Text variant="caption" style={styles.countText}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  count: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.lime, fontFamily: 'Geist_700Bold', fontSize: 10, lineHeight: 12 },
  blurClip: { overflow: 'hidden' },
  iconLayer: { zIndex: 1 },
  blurTint: { backgroundColor: 'rgba(255,255,255,0.42)' },
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
