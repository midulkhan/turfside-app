import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Phone, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Overline, ScreenHeader } from '@/components/ui/headers';
import { Input, PasswordInput, PhoneInput } from '@/components/ui/input';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { errorMessage } from '@/features/session/pending-signup';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { isBdMobile, isName } from '@/lib/validation';
import { createStyles } from '@/theme/styles';
import { colors, gutter, radius, space } from '@/theme/tokens';

const RESEND_SECONDS = 30;
const pretty = (p: string) => (p.length === 10 ? `+880 ${p.slice(0, 4)} ${p.slice(4)}` : `+880 ${p}`);

/** Edit your name, and change your phone number (confirmed with a code sent to the new number). */
export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Edit profile" onBack={() => router.back()} />
      </StickyHeader>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
          <Overline>Your name</Overline>
          <Card style={styles.card}>
            <NameForm />
          </Card>

          <Overline>Phone number</Overline>
          <Card style={styles.card}>
            <PhoneForm />
          </Card>
          <Text variant="caption" color={colors.textMuted} style={styles.note}>
            Your phone number is how you sign in. We text a code to the new number before changing it, and let your old number know.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function NameForm() {
  const { user, updateUser } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateProfile({ name: name.trim() }),
    onSuccess: (u) => {
      haptic.success();
      updateUser(u);
      setSubmitted(false);
    },
    onError: () => haptic.error(),
  });
  const changed = name.trim() !== (user?.name ?? '');
  const error = submitted && !isName(name) ? 'Enter your name (at least 2 letters).' : undefined;
  const submit = () => {
    setSubmitted(true);
    if (!isName(name)) return haptic.error();
    save.mutate();
  };
  return (
    <View style={styles.form}>
      <Input
        label="Full name"
        icon={UserRound}
        value={name}
        onChangeText={setName}
        maxLength={80}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={() => changed && submit()}
        error={error ?? (save.isError ? errorMessage(save.error) : undefined)}
      />
      {save.isSuccess && !changed ? (
        <View style={styles.saved}>
          <Check size={16} color={colors.limeText} strokeWidth={2.4} />
          <Text variant="labelStrong" color={colors.limeText}>
            Saved
          </Text>
        </View>
      ) : (
        <Button label="Save name" small onPress={submit} loading={save.isPending} disabled={!changed} />
      )}
    </View>
  );
}

function PhoneForm() {
  const { user, updateUser } = useSession();
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const start = useMutation({
    mutationFn: () => api.startPhoneChange(phone, password),
    onSuccess: (r) => {
      haptic.success();
      setStep('code');
      setWait(RESEND_SECONDS);
      // Outside production the server returns the code (no SMS gateway): fill it in for testing.
      if (r.devCode) setCode(r.devCode);
    },
    onError: () => haptic.error(),
  });
  const verify = useMutation({
    mutationFn: () => api.verifyPhoneChange(phone, code),
    onSuccess: (u) => {
      haptic.success();
      updateUser(u);
      Alert.alert('Number changed', `You now sign in with ${pretty(u.phone)}.`);
      setStep('details');
      setPhone('');
      setPassword('');
      setCode('');
      setSubmitted(false);
      start.reset();
    },
    onError: () => haptic.error(),
  });

  const phoneError = submitted && !isBdMobile(phone) ? 'Enter a valid mobile number.' : phone && phone === user?.phone ? 'That’s already your number.' : undefined;
  const sendCode = () => {
    setSubmitted(true);
    if (!isBdMobile(phone) || phone === user?.phone || !password) return haptic.error();
    start.mutate();
  };

  if (step === 'code')
    return (
      <View style={styles.form}>
        <View style={styles.head}>
          <Text variant="title">Enter the code</Text>
          <Text variant="label" color={colors.textMuted}>
            We sent a 6-digit code to {pretty(phone)}.
          </Text>
        </View>
        <Input
          label="Code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          placeholder="••••••"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => code.length === 6 && verify.mutate()}
          error={verify.isError ? errorMessage(verify.error) : undefined}
        />
        <Button label="Verify and change number" small onPress={() => verify.mutate()} loading={verify.isPending} disabled={code.length !== 6} />
        <View style={styles.links}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setStep('details');
              setCode('');
              verify.reset();
            }}>
            <Text variant="labelStrong" color={colors.textMuted}>
              Change number
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={8} disabled={wait > 0 || start.isPending} onPress={() => start.mutate()}>
            <Text variant="labelStrong" color={wait > 0 ? colors.textSubtle : colors.text}>
              {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
            </Text>
          </Pressable>
        </View>
      </View>
    );

  return (
    <View style={styles.form}>
      <View style={styles.current}>
        <View style={styles.currentIcon}>
          <Phone size={18} color={colors.ink} strokeWidth={1.8} />
        </View>
        <View style={styles.flex}>
          <Text variant="caption" color={colors.textMuted}>
            Current number
          </Text>
          <Text variant="bodyStrong">{user?.phone ? pretty(user.phone) : '—'}</Text>
        </View>
      </View>
      <PhoneInput label="New number" value={phone} onChangeText={setPhone} error={phoneError} />
      <PasswordInput
        label="Your password"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        hint="To confirm it’s you."
        returnKeyType="send"
        onSubmitEditing={sendCode}
        error={submitted && !password ? 'Enter your password.' : start.isError ? errorMessage(start.error) : undefined}
      />
      <Button label="Send code" small onPress={sendCode} loading={start.isPending} />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space[2], gap: space[3] },
  card: { padding: space[4] },
  form: { gap: space[3] },
  head: { gap: 2 },
  note: { paddingHorizontal: space[1] },
  saved: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], height: 44 },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[1], paddingTop: space[1] },
  current: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingBottom: space[1] },
  currentIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
}));
