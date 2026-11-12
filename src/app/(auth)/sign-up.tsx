import { router } from 'expo-router';
import { ArrowRight, LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Alert } from '@/components/ui/dialog';
import { AuthShell } from '@/components/auth/auth-shell';
import { SocialButtons } from '@/components/auth/social-buttons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput, PhoneInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { ApiError } from '@/features/api/types';
import { errorMessage, pendingSignup, sentToLabel } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { isBdMobile, isEmail, isName, isStrongPassword } from '@/lib/validation';
import { colors, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

export default function SignUp() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  // "Already has an account" from the server, pinned to the field it's about until that field changes.
  const [taken, setTaken] = useState<{ field: 'phone' | 'email'; message: string } | null>(null);

  const errors = {
    name: !isName(name) ? 'Enter your full name.' : undefined,
    phone: !isBdMobile(phone) ? 'Enter a valid 10-digit mobile number (1XXXXXXXXX).' : undefined,
    email: !isEmail(email) ? 'Enter a valid email address.' : undefined,
    password: !isStrongPassword(password) ? 'Use at least 8 characters.' : undefined,
  };
  const valid = !Object.values(errors).some(Boolean) && agree;

  const submit = async () => {
    setSubmitted(true);
    if (!valid) {
      haptic.error();
      return;
    }
    setLoading(true);
    const details = { name: name.trim(), phone, email: email.trim().toLowerCase(), password };
    try {
      const res = await api.signupStart(details);
      pendingSignup.set(details);
      router.push({ pathname: '/verify', params: { phone, devCode: res.devCode ?? '', sentTo: sentToLabel(res, phone) } });
    } catch (e) {
      haptic.error();
      // Number or email already registered: say so on that field, with a way to sign in.
      if (e instanceof ApiError && e.code === 'conflict' && (e.field === 'phone' || e.field === 'email')) setTaken({ field: e.field, message: e.message });
      else Alert.alert('Couldn’t create your account', errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const show = (k: keyof typeof errors) => (taken?.field === k ? taken.message : submitted ? errors[k] : undefined);
  const signInInstead = () =>
    router.replace({ pathname: '/sign-in', params: { identifier: taken?.field === 'email' ? email.trim().toLowerCase() : phone } });

  return (
    <AuthShell title="Create account" subtitle="Your next game starts here." corner={{ label: 'Sign in', href: '/sign-in' }} wave="b">
      <View style={styles.form}>
        <Input
          tone="dark"
          label="Full name"
          placeholder="Enter your full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          maxLength={80}
          error={show('name')}
        />
        <PhoneInput
          tone="dark"
          label="Mobile number"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            if (taken?.field === 'phone') setTaken(null);
          }}
          error={show('phone')}
        />
        <Input
          tone="dark"
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (taken?.field === 'email') setTaken(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
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
          textContentType="newPassword"
          maxLength={128}
          hint="At least 8 characters."
          error={show('password')}
        />
        <Checkbox tone="dark" checked={agree} onChange={setAgree}>
          <Text variant="label" color={submitted && !agree ? '#FF8A80' : colors.textOnDark}>
            I agree to the{' '}
            <Text variant="labelStrong" color={colors.textOnDark} style={styles.u}>
              Terms
            </Text>{' '}
            &{' '}
            <Text variant="labelStrong" color={colors.textOnDark} style={styles.u}>
              Privacy Policy
            </Text>
            .
          </Text>
        </Checkbox>
        {taken ? (
          <View style={styles.taken} accessibilityLiveRegion="polite">
            <Text variant="label" color={colors.textOnDark} style={styles.flex}>
              {taken.field === 'email' ? 'This email' : 'This number'} already has a TurfSides account.
            </Text>
            <Button label="Sign in instead" icon={LogIn} variant="primary" small onPress={signInInstead} />
          </View>
        ) : null}
        <Button label="Create account" trailingIcon={ArrowRight} onPress={submit} loading={loading} />
        <Text variant="label" color={colors.textOnDarkMuted} align="center">
          We’ll send a verification code to your email next.
        </Text>
      </View>

      <SocialButtons caption="or sign up with" onPress={() => Alert.alert('Coming soon', 'Sign up with your mobile number for now.')} />

      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-in')} hitSlop={8}>
          <Text variant="body" color={colors.textOnDark}>
            Already a member?{' '}
            <Text variant="bodyStrong" color={colors.lime}>
              Sign in
            </Text>
          </Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = createStyles(() => ({
  form: { gap: space[4] },
  flex: { flex: 1 },
  taken: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    paddingLeft: space[4],
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  links: { gap: space[4], alignItems: 'center', marginTop: space[2] },
  u: { textDecorationLine: 'underline' },
}));
