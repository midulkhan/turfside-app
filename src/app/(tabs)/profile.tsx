import { router, useScrollToTop } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Bell,
  Camera,
  ChevronRight,
  CircleHelp,
  FileText,
  KeyRound,
  LogOut,
  MapPin,
  Moon,
  Pencil,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';

import { Alert } from '@/components/ui/dialog';
import { LogoMark } from '@/components/brand/logo';
import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { Overline } from '@/components/ui/headers';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { useSettings, useUpdateSettings } from '@/features/api/queries';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { useTheme, type ThemePref } from '@/theme/theme-provider';
import { uploadPhoto } from '@/features/api/uploads';
import { errorMessage } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { PRESETS } from '@/lib/images';
import { useSession } from '@/features/session/session';
import { colors, gutter, radius, space, withAlpha } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';
import Constants from 'expo-constants';

function Row({
  icon: Icon,
  label,
  detail,
  onPress,
  danger,
  right,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  onPress?: () => void;
  danger?: boolean;
  /** A control in place of the chevron (switch, segmented control); the row itself isn't pressable. */
  right?: ReactNode;
}) {
  const body = (
    <>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Icon size={20} color={danger ? colors.danger : colors.ink} strokeWidth={1.8} />
      </View>
      <Text variant="body" color={danger ? colors.danger : colors.text} style={styles.flex} numberOfLines={1}>
        {label}
      </Text>
      {detail ? (
        <Text variant="label" color={colors.textMuted} numberOfLines={1} style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      {right ?? (!danger ? <ChevronRight size={20} color={colors.textSubtle} /> : null)}
    </>
  );
  if (right) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

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
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const notificationsOn = settings.data?.notifications ?? true;
  const theme = useTheme();
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
                <ActivityIndicator size="small" color={colors.charcoal} />
              ) : (
                <Camera size={14} color={colors.charcoal} strokeWidth={2.4} />
              )}
            </View>
            {photoBusy ? <View style={styles.dim} /> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => router.push('/edit-profile')}
            style={({ pressed }) => [styles.meText, pressed && styles.meTextPressed]}>
            <View style={styles.flex}>
              <Text variant="h3" numberOfLines={1}>
                {user?.name}
              </Text>
              <Text variant="label" color={colors.textMuted}>
                +880 {user?.phone}
              </Text>
            </View>
            <View style={styles.editBtn}>
              <Pencil size={16} color={colors.ink} strokeWidth={2} />
            </View>
          </Pressable>
        </Card>

        <Overline>Account</Overline>
        <Card padded={false}>
          <Row icon={UserRound} label="Edit profile" detail="Name, phone" onPress={() => router.push('/edit-profile')} />
          <Divider />
          <Row icon={MapPin} label="Set address" detail={place.name} onPress={() => router.push('/locations')} />
          <Divider />
          <Row
            icon={Bell}
            label="Notifications"
            right={
              <Switch
                value={notificationsOn}
                disabled={settings.isPending}
                accessibilityLabel="App notifications"
                onValueChange={(v) =>
                  updateSettings.mutate(
                    { notifications: v },
                    { onError: (e) => Alert.alert('Couldn’t change notifications', errorMessage(e)) },
                  )
                }
              />
            }
          />
          <Divider />
          <Row
            icon={KeyRound}
            label="Enable 2 Factor"
            right={
              <Switch
                value={!!settings.data?.twoFactor}
                disabled={settings.isPending || updateSettings.isPending}
                accessibilityLabel="Enable 2 Factor: email me a code when I sign in"
                onValueChange={(v) =>
                  updateSettings.mutate(
                    { twoFactor: v },
                    {
                      onSuccess: () =>
                        v
                          ? Alert.alert('Two-step sign-in is on', 'Next time you sign in, we’ll email you a 6-digit code to finish.')
                          : undefined,
                      onError: (e) => Alert.alert('Couldn’t change two-step sign-in', errorMessage(e)),
                    },
                  )
                }
              />
            }
          />
          <Divider />
          <Row
            icon={theme.scheme === 'dark' ? Moon : Sun}
            label="Appearance"
            right={<Segmented options={THEMES} value={theme.pref} onChange={theme.setPref} accessibilityLabel="Appearance" />}
          />
          <Divider />
          <Row icon={ShieldCheck} label="Privacy & security" onPress={() => router.push('/privacy')} />
        </Card>

        <Overline>Support</Overline>
        <Card padded={false}>
          <Row icon={Sparkles} label="View onboarding" onPress={() => router.push({ pathname: '/onboarding', params: { preview: '1' } })} />
          <Divider />
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

const styles = createStyles(() => ({
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
  dim: { position: 'absolute', left: 0, top: 0, width: 64, height: 64, borderRadius: 32, backgroundColor: withAlpha(colors.surface, 0.45) },
  me: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  meText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: radius.md },
  meTextPressed: { opacity: 0.7 },
  editBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
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
  detail: { maxWidth: '45%' },
  footer: { alignItems: 'center', gap: space[2], marginTop: space[4] },
}));
