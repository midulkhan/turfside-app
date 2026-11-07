import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronDown, KeyRound, LogOut, Monitor, Smartphone, Trash2, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Overline, ScreenHeader } from '@/components/ui/headers';
import { PasswordInput } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { errorMessage } from '@/features/session/pending-signup';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { isStrongPassword } from '@/lib/validation';
import { createStyles } from '@/theme/styles';
import { colors, gutter, radius, space } from '@/theme/tokens';

const SESSIONS = ['me', 'sessions'] as const;

function ago(ms: number) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 2) return 'Active now';
  if (m < 60) return `Active ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h} h ago`;
  const d = Math.round(h / 24);
  return `Active ${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** A tappable row that opens a panel underneath it (smooth height change). */
function Expandable({
  icon: Icon,
  label,
  hint,
  open,
  onToggle,
  danger,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Animated.View layout={LinearTransition.duration(220)}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
          <Icon size={19} color={danger ? colors.danger : colors.ink} strokeWidth={1.8} />
        </View>
        <View style={styles.flex}>
          <Text variant="body" color={danger ? colors.danger : colors.text}>
            {label}
          </Text>
          <Text variant="caption" color={colors.textMuted}>
            {hint}
          </Text>
        </View>
        <ChevronDown size={18} color={colors.textSubtle} style={open ? styles.flip : undefined} />
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.panel}>
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: (r) => {
      haptic.success();
      qc.invalidateQueries({ queryKey: SESSIONS });
      Alert.alert(
        'Password changed',
        r.signedOut
          ? `We signed you out on ${r.signedOut} other ${r.signedOut === 1 ? 'device' : 'devices'}.`
          : 'Use your new password next time you sign in.',
      );
      onDone();
    },
    onError: () => haptic.error(),
  });
  const nextError = submitted && !isStrongPassword(next) ? 'Use at least 8 characters.' : undefined;
  const confirmError = submitted && confirm !== next ? 'Passwords don’t match.' : undefined;
  const submit = () => {
    setSubmitted(true);
    if (!current || !isStrongPassword(next) || confirm !== next) return haptic.error();
    change.mutate();
  };
  return (
    <View style={styles.form}>
      <PasswordInput
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        autoComplete="current-password"
        textContentType="password"
        error={submitted && !current ? 'Enter your current password.' : undefined}
      />
      <PasswordInput
        label="New password"
        value={next}
        onChangeText={setNext}
        autoComplete="new-password"
        textContentType="newPassword"
        hint="At least 8 characters."
        error={nextError}
      />
      <PasswordInput
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={confirmError}
      />
      {change.isError ? (
        <Text variant="label" color={colors.danger}>
          {errorMessage(change.error)}
        </Text>
      ) : null}
      <Button label="Update password" variant="dark" loading={change.isPending} onPress={submit} />
      <Text variant="caption" color={colors.textMuted} align="center">
        Changing your password signs you out on your other devices.
      </Text>
    </View>
  );
}

function DeleteAccount() {
  const { signOut } = useSession();
  const [password, setPassword] = useState('');
  const del = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: async () => {
      haptic.success();
      await signOut(); // clears every cached screen and drops back to sign-in
      Alert.alert('Account deleted', 'Your TurfSides account and personal data have been removed.');
    },
    onError: () => haptic.error(),
  });
  const confirm = () => {
    if (!password) return haptic.error();
    Alert.alert('Delete your account?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete account', style: 'destructive', onPress: () => del.mutate() },
    ]);
  };
  return (
    <View style={styles.form}>
      <View style={styles.bullets}>
        {[
          'Your profile, photo, saved turfs and addresses are erased.',
          'You’re signed out on every device.',
          'Past bookings stay with the turf as anonymous records.',
          'You can sign up again later with the same number.',
        ].map((t) => (
          <View key={t} style={styles.bullet}>
            <View style={styles.dot} />
            <Text variant="label" color={colors.textMuted} style={styles.flex}>
              {t}
            </Text>
          </View>
        ))}
      </View>
      <PasswordInput
        label="Enter your password to confirm"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={confirm}
      />
      {del.isError ? (
        <Text variant="label" color={colors.danger}>
          {errorMessage(del.error)}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={del.isPending}
        onPress={confirm}
        style={({ pressed }) => [styles.dangerBtn, (pressed || del.isPending) && styles.dangerPressed]}>
        {del.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Trash2 size={18} color="#FFFFFF" strokeWidth={2} />}
        <Text variant="bodyStrong" color="#FFFFFF">
          Delete my account
        </Text>
      </Pressable>
    </View>
  );
}

function Devices() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS, queryFn: ({ signal }) => api.getSessions(signal), staleTime: 30_000 });
  const revoke = useMutation({
    mutationFn: api.revokeSession,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: SESSIONS });
      const prev = qc.getQueryData<api.DeviceSession[]>(SESSIONS);
      qc.setQueryData<api.DeviceSession[]>(SESSIONS, (l) => l?.filter((s) => s.id !== id));
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(SESSIONS, ctx.prev);
      Alert.alert('Couldn’t sign out that device', errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SESSIONS }),
  });
  const others = useMutation({
    mutationFn: api.revokeOtherSessions,
    onSuccess: (r) => {
      haptic.success();
      qc.setQueryData<api.DeviceSession[]>(SESSIONS, (l) => l?.filter((s) => s.current));
      Alert.alert(
        'Signed out',
        r.signedOut
          ? `Signed out on ${r.signedOut} other ${r.signedOut === 1 ? 'device' : 'devices'}.`
          : 'No other devices were signed in.',
      );
    },
    onError: (e) => Alert.alert('Couldn’t sign out other devices', errorMessage(e)),
  });
  const list = sessions.data ?? [];
  const otherCount = list.filter((s) => !s.current).length;

  if (sessions.isPending)
    return (
      <View style={styles.devicePad}>
        <Skeleton height={44} r={radius.sm} />
        <Skeleton height={44} r={radius.sm} />
      </View>
    );
  if (sessions.isError)
    return (
      <Pressable onPress={() => sessions.refetch()} style={styles.row}>
        <Text variant="label" color={colors.textMuted} style={styles.flex}>
          Couldn’t load your devices. Tap to retry.
        </Text>
      </Pressable>
    );
  return (
    <>
      {list.map((s, i) => {
        const Icon = /web/i.test(s.device) ? Monitor : Smartphone;
        return (
          <Animated.View key={s.id} layout={LinearTransition.duration(200)} exiting={FadeOut.duration(150)}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Icon size={19} color={colors.ink} strokeWidth={1.8} />
              </View>
              <View style={styles.flex}>
                <Text variant="body" numberOfLines={1}>
                  {s.device}
                </Text>
                <Text variant="caption" color={s.current ? colors.limeText : colors.textMuted}>
                  {s.current ? 'This device' : ago(s.lastActive)}
                </Text>
              </View>
              {!s.current ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sign out ${s.device}`}
                  hitSlop={8}
                  onPress={() =>
                    Alert.alert('Sign out this device?', s.device, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign out', style: 'destructive', onPress: () => revoke.mutate(s.id) },
                    ])
                  }
                  style={styles.signOutBtn}>
                  <Text variant="label" color={colors.danger}>
                    Sign out
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
      {otherCount > 0 ? (
        <>
          <Divider />
          <Pressable
            accessibilityRole="button"
            disabled={others.isPending}
            onPress={() =>
              Alert.alert(
                'Sign out everywhere else?',
                `You’ll stay signed in on this device. ${otherCount} other ${otherCount === 1 ? 'device' : 'devices'} will be signed out.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out others', style: 'destructive', onPress: () => others.mutate() },
                ],
              )
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={[styles.rowIcon, styles.rowIconDanger]}>
              {others.isPending ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <LogOut size={18} color={colors.danger} strokeWidth={1.9} />
              )}
            </View>
            <Text variant="body" color={colors.danger} style={styles.flex}>
              Sign out of all other devices
            </Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

export default function Privacy() {
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  const [open, setOpen] = useState<'password' | 'delete' | null>(null);
  const toggle = (k: 'password' | 'delete') => setOpen((o) => (o === k ? null : k));
  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Privacy & security" onBack={() => router.back()} />
      </StickyHeader>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
          <Overline>Sign-in</Overline>
          <Card padded={false}>
            <Expandable
              icon={KeyRound}
              label="Change password"
              hint="Update the password you sign in with"
              open={open === 'password'}
              onToggle={() => toggle('password')}>
              <ChangePassword onDone={() => setOpen(null)} />
            </Expandable>
          </Card>

          <Overline>Signed-in devices</Overline>
          <Card padded={false}>
            <Devices />
          </Card>
          <Text variant="caption" color={colors.textMuted} style={styles.note}>
            Don’t recognise a device? Sign it out and change your password.
          </Text>

          <Overline>Account</Overline>
          <Card padded={false}>
            <Expandable
              icon={Trash2}
              label="Delete account"
              hint="Permanently remove your account and data"
              danger
              open={open === 'delete'}
              onToggle={() => toggle('delete')}>
              <DeleteAccount />
            </Expandable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space[2], gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], minHeight: 64, paddingVertical: space[2] },
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
  flip: { transform: [{ rotate: '180deg' }] },
  panel: { paddingHorizontal: space[4], paddingBottom: space[4] },
  form: { gap: space[3] },
  bullets: { gap: space[2], paddingTop: space[1] },
  bullet: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textSubtle, marginTop: 7 },
  dangerBtn: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  dangerPressed: { opacity: 0.8 },
  devicePad: { padding: space[4], gap: space[3] },
  signOutBtn: { minHeight: 36, justifyContent: 'center', paddingLeft: space[2] },
  note: { paddingHorizontal: space[1] },
}));
