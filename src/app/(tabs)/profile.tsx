import { router, useScrollToTop } from 'expo-router';
import { useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Bell, Camera, ChevronRight, CircleHelp, FileText, LogOut, MapPin, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { LogoMark } from '@/components/brand/logo';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { Overline } from '@/components/ui/headers';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { useBookings } from '@/features/api/queries';
import { uploadPhoto } from '@/features/api/uploads';
import { errorMessage } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { PRESETS } from '@/lib/images';
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
  const scrollRef = useRef<ScrollViewInstance>(null);
  useScrollToTop(scrollRef as never);
  const scrolled = useScrolled();
  const bottom = useTabBarSpace();
  const { user, place, signOut, updateUser } = useSession();
  const [photoBusy, setPhotoBusy] = useState(false);

  const pickPhoto = async () => {
    // The system photo picker needs no library permission on iOS 14+ / Android 13+.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    setPhotoBusy(true);
    try {
      const key = await uploadPhoto('avatar', res.assets[0].uri, PRESETS.avatar);
      updateUser(await api.setAvatar(key));
      haptic.success();
    } catch (e) {
      haptic.error();
      Alert.alert('Couldn’t update your photo', errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      updateUser(await api.removeAvatar());
    } catch (e) {
      Alert.alert('Couldn’t remove your photo', errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const editPhoto = () =>
    user?.avatarUrl
      ? Alert.alert('Profile photo', undefined, [
          { text: 'Choose a new photo', onPress: pickPhoto },
          { text: 'Remove photo', style: 'destructive', onPress: removePhoto },
          { text: 'Cancel', style: 'cancel' },
        ])
      : pickPhoto();
  const { data } = useBookings();
  const played = data?.filter((b) => b.status === 'completed').length ?? 0;
  const upcoming = data?.filter((b) => b.status === 'confirmed').length ?? 0;
  const soon = (t: string) => () => Alert.alert(t, 'Coming in the next build.');

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.sticky}>
          <Text variant="pageTitle">Profile</Text>
        </View>
      </StickyHeader>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: space[2], paddingBottom: bottom, paddingHorizontal: gutter, gap: space[4] }}>
        <Card style={styles.me}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={user?.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
            onPress={editPhoto}
            disabled={photoBusy}
            hitSlop={6}>
            <Avatar name={user?.name ?? 'Player'} uri={user?.avatarUrl} size={64} />
            <View style={styles.camera}>
              {photoBusy ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Camera size={14} color={colors.ink} strokeWidth={2.4} />
              )}
            </View>
            {photoBusy ? <View style={styles.dim} /> : null}
          </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  sticky: { paddingHorizontal: gutter, paddingTop: space[4], paddingBottom: space[3] },
  flex: { flex: 1 },
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.lime,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { position: 'absolute', left: 0, top: 0, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.45)' },
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
