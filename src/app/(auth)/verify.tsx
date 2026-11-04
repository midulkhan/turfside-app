import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { colors, font, gutter, radius, space } from '@/theme/tokens';

const LEN = 6;
const RESEND_S = 30;
const MAX_ATTEMPTS = 5;

/** One-time SMS code. Server enforces expiry, attempt limits and rate limits; the UI mirrors them. */
export default function Verify() {
  const {
    phone = '',
    name = 'Player',
    role = 'player',
  } = useLocalSearchParams<{ phone: string; name: string; role: 'player' | 'owner' }>();
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

  const masked = phone.length === 10 ? `+880 ${phone.slice(0, 4)} ••• ${phone.slice(-3)}` : '+880';
  const locked = attempts >= MAX_ATTEMPTS;

  const submit = async (value = code) => {
    if (value.length !== LEN || locked) return;
    setLoading(true);
    // TODO(api): POST /auth/verify { phone, code } → { user, accessToken }
    await new Promise((r) => setTimeout(r, 500));
    if (value !== '123456') {
      haptic.error();
      setAttempts((a) => a + 1);
      setError(attempts + 1 >= MAX_ATTEMPTS ? 'Too many attempts. Request a new code.' : 'That code is not right. Try again.');
      setCode('');
      setLoading(false);
      return;
    }
    haptic.success();
    await signIn({ id: 'u_demo', name, phone, roles: role === 'owner' ? ['player', 'owner'] : ['player'] }, 'mock-token');
    router.replace(role === 'owner' ? '/owner' : '/explore');
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.top}>
        <IconButton icon={ArrowLeft} label="Go back" variant="dark" onPress={() => router.back()} style={styles.back} />
      </View>
      <View style={styles.body}>
        <View style={styles.badge}>
          <ShieldCheck size={28} color={colors.ink} strokeWidth={2} />
        </View>
        <Text variant="h1" color={colors.textOnDark}>
          Verify your number
        </Text>
        <Text variant="body" color={colors.textOnDarkMuted}>
          Enter the 6-digit code we sent to {masked}.
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
          autoComplete="sms-otp"
          maxLength={LEN}
          style={styles.hidden}
          editable={!locked}
        />
        {error ? (
          <Text variant="label" color="#FF8A80">
            {error}
          </Text>
        ) : (
          <Text variant="caption" color={colors.textOnDarkMuted}>
            Demo code: 123456
          </Text>
        )}

        <Button label="Verify and continue" onPress={() => submit()} loading={loading} disabled={code.length !== LEN || locked} />
        <Pressable
          disabled={left > 0}
          onPress={() => {
            setLeft(RESEND_S);
            setAttempts(0);
            setError(undefined);
          }}
          style={styles.resend}
          accessibilityRole="button">
          <Text variant="bodyStrong" color={left > 0 ? colors.textOnDarkMuted : colors.lime}>
            {left > 0 ? `Resend code in 0:${String(left).padStart(2, '0')}` : 'Resend code'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
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
});
