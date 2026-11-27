import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { ApiError } from '@/features/api/types';
import { errorMessage, pendingSignup, sentToLabel } from '@/features/session/pending-signup';
import { finishAuth } from '@/features/session/auth-gate';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { colors, font, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const LEN = 6;
const RESEND_S = 30;
const MAX_ATTEMPTS = 5;

/** One-time code (emailed). Server enforces expiry, attempt limits and rate limits; the UI mirrors them. */
export default function Verify() {
  // mode=login: second step of sign-in (challenge from the password step). Otherwise sign-up.
  const params = useLocalSearchParams<{ phone?: string; devCode?: string; sentTo?: string; mode?: string; challenge?: string }>();
  const isLogin = params.mode === 'login';
  const [challenge, setChallenge] = useState(params.challenge || '');
  const [sentTo, setSentTo] = useState(params.sentTo || '');
  const { phone = '' } = params;
  const [devCode, setDevCode] = useState(params.devCode || '');
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [attempts, setAttempts] = useState(0);
  const [left, setLeft] = useState(RESEND_S);
  const [loading, setLoading] = useState(false);
  const input = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const locked = attempts >= MAX_ATTEMPTS;

  const submit = async (value = code) => {
    if (value.length !== LEN || locked) return;
    setLoading(true);
    try {
      const auth = isLogin ? await api.loginVerify(challenge, value) : await api.signupVerify(phone, value);
      haptic.success();
      if (!isLogin) pendingSignup.clear();
      await signIn(auth);
      finishAuth(); // back to where they were, or Explore
    } catch (e) {
      haptic.error();
      const tooMany = e instanceof ApiError && e.code === 'rate_limited';
      setAttempts((a) => (tooMany ? MAX_ATTEMPTS : a + 1));
      setError(errorMessage(e));
      setCode('');
      setLoading(false);
    }
  };

  const resend = async () => {
    if (isLogin) {
      setLeft(RESEND_S);
      setError(undefined);
      try {
        const res = await api.loginResend(challenge);
        setChallenge(res.challenge);
        setAttempts(0);
        setDevCode(res.devCode ?? '');
        setSentTo(sentToLabel(res, ''));
      } catch (e) {
        setError(errorMessage(e));
      }
      return;
    }
    const details = pendingSignup.get();
    if (!details || details.phone !== phone) {
      router.back(); // app was restarted: the form has to be filled in again
      return;
    }
    setLeft(RESEND_S);
    setError(undefined);
    try {
      const res = await api.signupStart(details);
      setAttempts(0);
      setDevCode(res.devCode ?? '');
      setSentTo(sentToLabel(res, phone));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.top}>
        <IconButton icon={ArrowLeft} label="Go back" variant="dark" onPress={() => router.back()} style={styles.back} />
      </View>
      <View style={styles.body}>
        <View style={styles.badge}>
          <ShieldCheck size={28} color={colors.charcoal} strokeWidth={2} />
        </View>
        <Text variant="h1" color={colors.textOnDark}>
          Enter your code
        </Text>
        <Text variant="body" color={colors.textOnDarkMuted}>
          We sent a 6-digit code to {sentTo || 'your email'}. It can take a minute; check spam if it’s not there.
        </Text>

        <Pressable onPress={() => input.current?.focus()} style={styles.cells} accessibilityLabel="Verification code">
          {Array.from({ length: LEN }).map((_, i) => {
            const ch = code[i];
            const active = i === code.length;
            return (
              <View key={i} style={[styles.cell, active && styles.cellActive, !!error && styles.cellError]}>
                <Text variant="h2" color={colors.textOnDark}>
                  {ch ?? ''}
                </Text>
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={input}
          value={code}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, LEN);
            setCode(digits);
            setError(undefined);
            if (digits.length === LEN) submit(digits);
          }}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={LEN}
          style={styles.hidden}
          editable={!locked}
        />
        {error ? (
          <Text variant="label" color="#FF8A80">
            {error}
          </Text>
        ) : devCode ? (
          // Only test servers send this, when the email could not go out. Production never does.
          <Text variant="caption" color={colors.textOnDarkMuted}>
            Test code: {devCode}
          </Text>
        ) : null}

        <Button label="Verify and continue" onPress={() => submit()} loading={loading} disabled={code.length !== LEN || locked} />
        <Pressable disabled={left > 0} onPress={resend} style={styles.resend} accessibilityRole="button">
          <Text variant="bodyStrong" color={left > 0 ? colors.textOnDarkMuted : colors.lime}>
            {left > 0 ? `Resend code in 0:${String(left).padStart(2, '0')}` : 'Resend code'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-in')} style={styles.resend}>
          <Text variant="label" color={colors.textOnDarkMuted} align="center">
            No code? If this number already has an account, sign in instead.
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.deep },
  top: { paddingHorizontal: gutter, paddingTop: space[2] },
  back: { borderColor: colors.borderOnDark, backgroundColor: colors.inkRaised },
  body: { paddingHorizontal: gutter, gap: space[4], marginTop: space[6] },
  badge: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  cells: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    backgroundColor: colors.inkRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: colors.lime },
  cellError: { borderColor: '#FF8A80' },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1, fontFamily: font.regular },
  resend: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
}));
