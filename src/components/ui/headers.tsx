import { ArrowLeft, type LucideIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, gutter, space } from '@/theme/tokens';

import { IconButton } from './icon-button';
import { Text } from './text';

/** Top bar: round back button · centred title (or logo) · optional right action. */
export function ScreenHeader({
  title,
  center,
  right,
  leftIcon = ArrowLeft,
  onBack,
}: {
  title?: string;
  center?: ReactNode;
  right?: ReactNode;
  leftIcon?: LucideIcon;
  onBack?: () => void;
}) {
  return (
    <View style={styles.bar}>
      <IconButton icon={leftIcon} label="Go back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />
      <View style={styles.center}>
        {center ?? (
          <Text variant="h3" numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>
      <View style={styles.side}>{right}</View>
    </View>
  );
}

/** Section title row, e.g. "Recommended nearby". */
export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="h3" style={styles.sectionTitle} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Overline({ children, color = colors.textMuted }: { children: string; color?: string }) {
  return (
    <Text variant="overline" color={color}>
      {children.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, paddingVertical: space[2], gap: space[3] },
  center: { flex: 1, alignItems: 'center' },
  side: { width: 48, alignItems: 'flex-end' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  sectionTitle: { flex: 1, fontSize: 20, lineHeight: 26 },
});
