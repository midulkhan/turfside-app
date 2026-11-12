import { ArrowUpRight } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';

import { Wordmark } from '@/components/brand/logo';
import { Text } from '@/components/ui/text';
import { colors, gutter, palettes, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

type Props = {
  title: string;
  subtitle: string;
  corner: { label: string; href: '/sign-in' | '/sign-up' };
  badge?: string;
  children: ReactNode;
  wave?: 'a' | 'b';
};

/** The header is light in both themes, so its text uses the light palette. */
const HEAD = palettes.light;

/** Shared layout for sign in / sign up: a short light header, a high wave, then the title and form on dark. */
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
        {/* Dark icons over the light header, whatever the app theme. */}
        <StatusBar style="dark" />
        <View style={[styles.top, { paddingTop: insets.top + space[5] }]}>
          <View style={styles.topRow}>
            <View style={styles.brand}>
              <Wordmark height={30} fill={HEAD.ink} />
              {badge ? (
                <View style={styles.badge}>
                  <Text variant="caption" color={HEAD.ink} style={styles.badgeText}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.replace(corner.href)} style={styles.corner}>
              <Text variant="bodyStrong" color={HEAD.ink}>
                {corner.label}
              </Text>
              <ArrowUpRight size={18} color={HEAD.ink} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
        <Svg width="100%" height={110} viewBox={`0 0 ${w} 110`} preserveAspectRatio="none" style={styles.wave}>
          <Path d={d} fill={colors.deep} />
        </Svg>
        <View style={[styles.dark, { paddingBottom: insets.bottom + space[6] }]}>
          {/* The title sits on the dark side, right above the form it introduces. */}
          <View style={styles.heading}>
            <Text variant="h1" color={colors.textOnDark}>
              {title}
            </Text>
            <Text variant="body" color={colors.textOnDarkMuted}>
              {subtitle}
            </Text>
          </View>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = createStyles(() => ({
  flex: { flex: 1, backgroundColor: colors.deep },
  grow: { flexGrow: 1, backgroundColor: colors.deep },
  top: { backgroundColor: colors.authTop, paddingHorizontal: gutter, paddingBottom: space[3] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { gap: space[1] },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: HEAD.ink,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  badgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1 },
  corner: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  heading: { gap: space[1], marginBottom: space[2] },
  wave: { backgroundColor: colors.authTop, marginTop: -1 },
  dark: { flex: 1, backgroundColor: colors.deep, paddingHorizontal: gutter, gap: space[4], marginTop: -1 },
}));
