import { router, type Href } from 'expo-router';
import { ChevronRight, CircleHelp, LogOut, UserPlus, UsersRound, X, type LucideIcon } from 'lucide-react-native';
import { useRef } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { Wordmark } from '@/components/brand/logo';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { colors, getScheme, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

type Item = { icon: LucideIcon; label: string; href: Href };

// Bookings, saved turfs, notifications and the profile live in the tab bar and header.
const ITEMS: Item[] = [
  { icon: UserPlus, label: 'Join a squad', href: '/join' },
  { icon: UsersRound, label: 'Find players', href: '/players' },
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
      <item.icon size={22} color={colors.ink} strokeWidth={1.7} />
      <Text variant="bodyStrong" style={styles.flex}>
        {item.label}
      </Text>
      <ChevronRight size={18} color={colors.textSubtle} strokeWidth={1.8} />
    </Pressable>
  );

  const askLogout = () =>
    Alert.alert('Log out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => go(() => signOut()) },
    ]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      side="left"
      style={getScheme() === 'dark' ? styles.panelDark : undefined}
      width={Math.min(width * 0.84, 340)}
      onClosed={() => {
        const fn = pending.current;
        pending.current = null;
        fn?.();
      }}>
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + space[3] }]}
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
        </ScrollView>

        {/* Pinned to the bottom, set apart by a hairline. */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + space[4] }]}>
          <Pressable accessibilityRole="button" onPress={askLogout} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.logoutIcon}>
              <LogOut size={17} color="#FFFFFF" strokeWidth={2} />
            </View>
            <Text variant="bodyStrong" style={styles.flex}>
              Logout
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const ROW_PAD = space[2];

const styles = createStyles(() => ({
  /** Darker than cards in dark mode, so the drawer reads as its own layer. */
  panelDark: { backgroundColor: colors.deep },
  content: { paddingHorizontal: gutter, gap: space[6] },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  group: { gap: 2 },
  // Icons line up with the logo's left edge; the pressed highlight reaches a little past it.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: 54,
    borderRadius: radius.md,
    paddingHorizontal: ROW_PAD,
    marginHorizontal: -ROW_PAD,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logoutIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.inverse, // dark in both themes, still visible on the dark drawer
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -5, // wider than a 22px icon: centred on the icon column, label stays aligned
  },
}));
