import { router, type Href } from 'expo-router';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Heart,
  LogOut,
  Settings,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme/tokens';

type Item = { icon: LucideIcon; label: string; href: Href; badge?: string };

const MAIN: Item[] = [
  { icon: CalendarDays, label: 'My bookings', href: '/bookings' },
  { icon: UsersRound, label: 'Your requests', href: '/requests', badge: '1' },
  { icon: Heart, label: 'Saved turfs', href: '/saved' },
  { icon: Bell, label: 'Notifications', href: '/notifications' },
];
const MORE: Item[] = [
  { icon: Settings, label: 'Account & settings', href: '/profile' },
  { icon: CircleHelp, label: 'Help & support', href: '/profile' },
];

/** Left drawer opened from the Explore menu button. Navigation happens after the drawer finishes closing. */
export function SideMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, signOut } = useSession();
  const pending = useRef<(() => void) | null>(null);

  const go = (fn: () => void) => {
    haptic.select();
    pending.current = fn;
    onClose();
  };

  const Row = ({ item }: { item: Item }) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => go(() => router.push(item.href))}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowIcon}>
        <item.icon size={20} color={colors.ink} strokeWidth={1.9} />
      </View>
      <Text variant="bodyStrong" style={styles.flex}>
        {item.label}
      </Text>
      {item.badge ? (
        <View style={styles.badge}>
          <Text variant="caption" style={styles.badgeText}>
            {item.badge}
          </Text>
        </View>
      ) : null}
      <ChevronRight size={18} color={colors.textSubtle} />
    </Pressable>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      side="left"
      width={Math.min(width * 0.84, 340)}
      onClosed={() => {
        const fn = pending.current;
        pending.current = null;
        fn?.();
      }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[5] }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Wordmark height={24} />
          <IconButton icon={X} label="Close menu" size={40} onPress={onClose} />
        </View>

        <Pressable accessibilityRole="button" onPress={() => go(() => router.push('/profile'))} style={styles.me}>
          <Avatar name={user?.name ?? 'Player'} size={52} />
          <View style={styles.flex}>
            <Text variant="title">{user?.name}</Text>
            <Text variant="label" color={colors.textMuted}>
              +880 {user?.phone}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textSubtle} />
        </Pressable>

        <View style={styles.group}>
          {MAIN.map((it) => (
            <Row key={it.label} item={it} />
          ))}
        </View>
        <Divider />
        <View style={styles.group}>
          {MORE.map((it) => (
            <Row key={it.label} item={it} />
          ))}
        </View>

        <Pressable accessibilityRole="button" onPress={() => go(() => signOut())} style={styles.signOut}>
          <LogOut size={20} color={colors.danger} strokeWidth={1.9} />
          <Text variant="bodyStrong" color={colors.danger}>
            Sign out
          </Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, gap: space[4] },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  me: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: colors.bg, borderRadius: radius.lg, padding: space[3] },
  group: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, borderRadius: radius.md, paddingHorizontal: space[2] },
  pressed: { backgroundColor: colors.bg },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.lime, fontFamily: 'Geist_700Bold' },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 48, paddingHorizontal: space[2] },
});
