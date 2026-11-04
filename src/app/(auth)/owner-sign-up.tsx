import { router } from 'expo-router';
import { ArrowRight, ArrowUpRight } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput, PhoneInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { errorMessage, pendingSignup } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { isBdMobile, isEmail, isName, isStrongPassword } from '@/lib/validation';
import { colors, radius, space } from '@/theme/tokens';

function PitchIcon() {
  return (
    <Svg width={56} height={40} viewBox="0 0 56 40" fill="none" stroke={colors.textOnDark} strokeWidth={2}>
      <Rect x={1} y={1} width={54} height={38} rx={4} />
      <Line x1={28} y1={1} x2={28} y2={39} />
      <Circle cx={28} cy={20} r={7} />
      <Rect x={1} y={11} width={8} height={18} />
      <Rect x={47} y={11} width={8} height={18} />
    </Svg>
  );
}

export default function OwnerSignUp() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const errors = {
    name: !isName(name) ? 'Enter your full name.' : undefined,
    phone: !isBdMobile(phone) ? 'Enter a valid 10-digit mobile number.' : undefined,
    email: !isEmail(email) ? 'Enter a valid business email.' : undefined,
    password: !isStrongPassword(password) ? 'Use at least 8 characters.' : undefined,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean) || !agree) {
      haptic.error();
      return;
    }
    setLoading(true);
    const details = { name: name.trim(), phone, email: email.trim() || undefined, password, role: 'owner' as const };
    try {
      const res = await api.signupStart(details);
      pendingSignup.set(details);
      router.push({ pathname: '/verify', params: { phone, role: 'owner', devCode: res.devCode ?? '' } });
    } catch (e) {
      haptic.error();
      Alert.alert('Couldn’t create your account', errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Become a turf owner"
      subtitle="Bring your pitch to more players."
      corner={{ label: 'Sign in', href: '/sign-in' }}
      badge="OWNER"
      wave="b">
      <View style={styles.steps}>
        <Text variant="bodyStrong" color={colors.lime}>
          01 Account
        </Text>
        <View style={styles.stepLine} />
        <Text variant="body" color={colors.textOnDarkMuted}>
          02 List your turf
        </Text>
      </View>
      <View style={styles.form}>
        <Input
          tone="dark"
          label="Owner’s full name"
          placeholder="Enter your full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          autoCapitalize="words"
          maxLength={80}
          error={show('name')}
        />
        <PhoneInput tone="dark" label="Business mobile number" value={phone} onChangeText={setPhone} error={show('phone')} />
        <Input
          tone="dark"
          label="Business email"
          placeholder="you@business.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          maxLength={254}
          error={show('email')}
        />
        <PasswordInput
          tone="dark"
          label="Password"
          placeholder="Create a password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          maxLength={128}
          hint="At least 8 characters."
          error={show('password')}
        />
        <Checkbox tone="dark" checked={agree} onChange={setAgree}>
          <Text variant="label" color={submitted && !agree ? '#FF8A80' : colors.textOnDark}>
            I agree to the{' '}
            <Text variant="labelStrong" color={colors.textOnDark} style={styles.u}>
              Owner Terms
            </Text>{' '}
            &{' '}
            <Text variant="labelStrong" color={colors.textOnDark} style={styles.u}>
              Privacy Policy
            </Text>
            .
          </Text>
        </Checkbox>
        <Button label="Create owner account" trailingIcon={ArrowRight} spread onPress={submit} loading={loading} />
        <Text variant="label" color={colors.textOnDarkMuted} align="center">
          Verify your number, then add your turf details.
        </Text>
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} style={styles.existing}>
        <PitchIcon />
        <View style={styles.vr} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" color={colors.textOnDark}>
            Already have a player account?
          </Text>
          <Text variant="bodyStrong" color={colors.lime}>
            Sign in to add an owner profile.
          </Text>
        </View>
      </Pressable>

      <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-up')} style={styles.row} hitSlop={8}>
        <Text variant="bodyStrong" color={colors.textOnDark}>
          Here to play?{' '}
          <Text variant="bodyStrong" color={colors.textOnDark} style={styles.u}>
            Create a player account
          </Text>
        </Text>
        <ArrowUpRight size={16} color={colors.textOnDark} />
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stepLine: { flex: 1, height: 1, backgroundColor: colors.textOnDarkMuted },
  form: { gap: space[4] },
  existing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.lg,
    padding: space[4],
    marginTop: space[2],
  },
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.2)' },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center' },
  u: { textDecorationLine: 'underline' },
});
