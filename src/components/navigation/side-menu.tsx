import { router, type Href } from 'expo-router';
import { ChevronRight, CircleHelp, LogOut, UsersRound, X, type LucideIcon } from 'lucide-react-native';
import { useRef } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { Divider } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { colors, gutter, radius, space } from '@/theme/tokens';

type Item = { icon: LucideIcon; label: string; href: Href };

// Bookings, saved turfs, notifications and the profile live in the tab bar and header.
const ITEMS: Item[] = [
  { icon: UsersRound, label: 'Player calls', href: '/requests' },
  { icon: CircleHelp, label: 'Help & support', href: '/profile' },
];

/** Left drawer opened from the Explore menu button. Navigation happens after the drawer finishes closing. */
export function SideMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { signOut } = useSession();
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

        <View style={styles.group}>
          {ITEMS.map((it) => (
            <Row key={it.label} item={it} />
          ))}
        </View>
        <Divider />
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            Alert.alert('Log out?', 'You can sign back in any time.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Logout', style: 'destructive', onPress: () => go(() => signOut()) },
            ])
          }
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={[styles.rowIcon, styles.logoutIcon]}>
            <LogOut size={20} color={colors.danger} strokeWidth={1.9} />
          </View>
          <Text variant="bodyStrong" color={colors.danger} style={styles.flex}>
            Logout
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
  logoutIcon: { backgroundColor: colors.dangerSoft },
});
