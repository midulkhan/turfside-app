import { router, useScrollToTop } from 'expo-router';
import { useRef } from 'react';
import { Bell, ChevronRight, CircleHelp, FileText, LogOut, MapPin, ShieldCheck, Store, type LucideIcon } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/brand/logo';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { Overline } from '@/components/ui/headers';
import { Text } from '@/components/ui/text';
import { useBookings } from '@/features/api/queries';
import { useSession } from '@/features/session/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import Constants from 'expo-constants';

function Row({
  icon: Icon,
  label,
  detail,
  onPress,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Icon size={20} color={danger ? colors.danger : colors.ink} strokeWidth={1.9} />
      </View>
      <Text variant="bodyStrong" color={danger ? colors.danger : colors.text} style={styles.flex}>
        {label}
      </Text>
      {detail ? (
        <Text variant="label" color={colors.textMuted}>
          {detail}
        </Text>
      ) : null}
      {!danger ? <ChevronRight size={20} color={colors.textSubtle} /> : null}
    </Pressable>
  );
}

export default function Profile() {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef as never);
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const { user, place, signOut } = useSession();
  const { data } = useBookings();
  const played = data?.filter((b) => b.status === 'completed').length ?? 0;
  const upcoming = data?.filter((b) => b.status === 'confirmed').length ?? 0;
  const soon = (t: string) => () => Alert.alert(t, 'Coming in the next build.');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + space[4], paddingBottom: bottom, paddingHorizontal: gutter, gap: space[4] }}>
      <Text variant="pageTitle">Profile</Text>

      <Card style={styles.me}>
        <Avatar name={user?.name ?? 'Player'} size={64} />
        <View style={styles.flex}>
          <Text variant="h3">{user?.name}</Text>
          <Text variant="label" color={colors.textMuted}>
            +880 {user?.phone}
          </Text>
        </View>
      </Card>

      <View style={styles.stats}>
        <Card tone="dark" style={styles.stat}>
          <Text variant="number" color={colors.lime}>
            {upcoming}
          </Text>
          <Text variant="label" color={colors.textOnDarkMuted}>
            Upcoming
          </Text>
        </Card>
        <Card tone="lime" style={styles.stat}>
          <Text variant="number">{played}</Text>
          <Text variant="label">Games played</Text>
        </Card>
      </View>

      <Overline>Account</Overline>
      <Card padded={false}>
        <Row icon={MapPin} label="Home area" detail={place.name} onPress={() => router.navigate('/explore')} />
        <Divider />
        <Row icon={Bell} label="Notifications" onPress={() => router.push('/notifications')} />
        <Divider />
        <Row icon={ShieldCheck} label="Privacy & security" onPress={soon('Privacy & security')} />
      </Card>

      <Overline>For turf owners</Overline>
      <Card padded={false}>
        <Row
          icon={Store}
          label={user?.roles.includes('owner') ? 'Open owner workspace' : 'List your turf'}
          onPress={() => router.push('/owner')}
        />
      </Card>

      <Overline>Support</Overline>
      <Card padded={false}>
        <Row icon={CircleHelp} label="Help & support" onPress={soon('Help & support')} />
        <Divider />
        <Row icon={FileText} label="Terms & privacy policy" onPress={soon('Terms & privacy policy')} />
        <Divider />
        <Row
          icon={LogOut}
          label="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out?', 'You can sign back in any time.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
            ])
          }
        />
      </Card>

      <View style={styles.footer}>
        <LogoMark height={22} />
        <Text variant="caption" color={colors.textSubtle}>
          Version {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  me: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  stats: { flexDirection: 'row', gap: space[3] },
  stat: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], minHeight: 60 },
  pressed: { backgroundColor: colors.bg },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.dangerSoft },
  footer: { alignItems: 'center', gap: space[2], marginTop: space[4] },
});
