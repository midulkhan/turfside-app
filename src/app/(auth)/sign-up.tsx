import { router } from 'expo-router';
import { ArrowRight, ArrowUpRight } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AuthShell } from '@/components/auth/auth-shell';
import { SocialButtons } from '@/components/auth/social-buttons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput, PhoneInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { haptic } from '@/lib/haptics';
import { isBdMobile, isEmail, isName, isStrongPassword } from '@/lib/validation';
import { colors, space } from '@/theme/tokens';

export default function SignUp() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const errors = {
    name: !isName(name) ? 'Enter your full name.' : undefined,
    phone: !isBdMobile(phone) ? 'Enter a valid 10-digit mobile number (1XXXXXXXXX).' : undefined,
    email: email && !isEmail(email) ? 'Enter a valid email or leave it empty.' : undefined,
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
    // TODO(api): POST /auth/sign-up → sends SMS code. Rate-limited server-side.
    await new Promise((r) => setTimeout(r, 500));
    setLoading(false);
    router.push({ pathname: '/verify', params: { phone, name, role: 'player' } });
  };

  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

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
        <PhoneInput tone="dark" label="Mobile number" value={phone} onChangeText={setPhone} error={show('phone')} />
        <Input
          tone="dark"
          label="Email (optional)"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
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
        <Button label="Create account" trailingIcon={ArrowRight} onPress={submit} loading={loading} />
        <Text variant="label" color={colors.textOnDarkMuted} align="center">
          We’ll verify your mobile number next.
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
        <Pressable accessibilityRole="link" onPress={() => router.replace('/owner-sign-up')} style={styles.row} hitSlop={8}>
          <Text variant="body" color={colors.textOnDarkMuted}>
            Own a turf?{' '}
            <Text variant="body" color={colors.textOnDarkMuted} style={styles.u}>
              Register as an owner
            </Text>
          </Text>
          <ArrowUpRight size={16} color={colors.textOnDarkMuted} />
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  links: { gap: space[4], alignItems: 'center', marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  u: { textDecorationLine: 'underline' },
});
