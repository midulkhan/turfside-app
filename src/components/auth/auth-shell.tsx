import { ArrowUpRight } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Wordmark } from '@/components/brand/logo';
import { Text } from '@/components/ui/text';
import { colors, gutter, radius, space } from '@/theme/tokens';

type Props = {
  title: string;
  subtitle: string;
  corner: { label: string; href: '/sign-in' | '/sign-up' };
  badge?: string;
  children: ReactNode;
  wave?: 'a' | 'b';
};

/** Shared layout for sign in / sign up / owner sign up: light header, wave, dark form. */
export function AuthShell({ title, subtitle, corner, badge, children, wave = 'a' }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const w = Math.min(width, 520);
  const d =
    wave === 'a'
      ? `M0 40 C ${w * 0.25} 95, ${w * 0.55} 110, ${w * 0.72} 70 C ${w * 0.85} 38, ${w * 0.93} 20, ${w} 0 L ${w} 120 L 0 120 Z`
      : `M0 30 C ${w * 0.3} 95, ${w * 0.6} 20, ${w} 10 L ${w} 120 L 0 120 Z`;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.grow}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.top, { paddingTop: insets.top + space[3] }]}>
          <View style={styles.topRow}>
            <View style={styles.brand}>
              <Wordmark height={30} />
              {badge ? (
                <View style={styles.badge}>
                  <Text variant="caption" style={styles.badgeText}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.replace(corner.href)} style={styles.corner}>
              <Text variant="bodyStrong">{corner.label}</Text>
              <ArrowUpRight size={18} color={colors.ink} strokeWidth={2.2} />
            </Pressable>
          </View>
          <View style={styles.heading}>
            <Text variant="h1" align="center">
              {title}
            </Text>
            <Text variant="body" color={colors.textMuted} align="center">
              {subtitle}
            </Text>
          </View>
        </View>
        <Svg width="100%" height={110} viewBox={`0 0 ${w} 110`} preserveAspectRatio="none" style={styles.wave}>
          <Path d={d} fill={colors.ink} />
        </Svg>
        <View style={[styles.dark, { paddingBottom: insets.bottom + space[6] }]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink },
  grow: { flexGrow: 1, backgroundColor: colors.ink },
  top: { backgroundColor: colors.bg, paddingHorizontal: gutter, paddingBottom: space[2] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { gap: space[1] },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  badgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1 },
  corner: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  heading: { alignItems: 'center', gap: space[2], marginTop: space[5] },
  wave: { backgroundColor: colors.bg, marginTop: -1 },
  dark: { flex: 1, backgroundColor: colors.ink, paddingHorizontal: gutter, gap: space[4], marginTop: -1 },
});
