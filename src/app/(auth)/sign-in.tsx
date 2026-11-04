import { router } from 'expo-router';
import { ArrowUpRight, LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AuthShell } from '@/components/auth/auth-shell';
import { SocialButtons } from '@/components/auth/social-buttons';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { isStrongPassword, normaliseIdentifier } from '@/lib/validation';
import { colors, space } from '@/theme/tokens';

export default function SignIn() {
  const { signIn } = useSession();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const ident = normaliseIdentifier(id);
  const idError = submitted && !ident ? 'Enter a valid Bangladesh mobile number or email.' : undefined;
  const pwError = submitted && !isStrongPassword(password) ? 'Password must be at least 8 characters.' : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (!ident || !isStrongPassword(password)) {
      haptic.error();
      return;
    }
    setLoading(true);
    // TODO(api): POST /auth/sign-in → { user, accessToken }. Generic errors only (no "user not found").
    await new Promise((r) => setTimeout(r, 600));
    await signIn(
      {
        id: 'u_demo',
        name: 'Midul Hossen',
        phone: ident.kind === 'phone' ? ident.value : '1712345678',
        email: ident.kind === 'email' ? ident.value : undefined,
        roles: ['player'],
      },
      'mock-token',
    );
    setLoading(false);
    router.replace('/explore');
  };

  return (
    <AuthShell title="Sign in" subtitle="Your next game starts here." corner={{ label: 'Sign up', href: '/sign-up' }}>
      <View style={styles.form}>
        <Input
          tone="dark"
          label="Mobile number or email"
          placeholder="Enter mobile number or email"
          value={id}
          onChangeText={setId}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          error={idError}
        />
        <PasswordInput
          tone="dark"
          label="Password"
          placeholder="Enter password"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={pwError}
        />
        <Pressable accessibilityRole="link" onPress={() => router.push('/forgot-password')} style={styles.forgot} hitSlop={8}>
          <Text variant="label" color={colors.textOnDarkMuted}>
            Forgot password?
          </Text>
        </Pressable>
        <Button label="Sign in" icon={LogIn} onPress={submit} loading={loading} />
      </View>

      <SocialButtons caption="or continue with" onPress={() => Alert.alert('Coming soon', 'Sign in with your mobile number for now.')} />

      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-up')} hitSlop={8}>
          <Text variant="body" color={colors.textOnDark} align="center">
            New here?{' '}
            <Text variant="bodyStrong" color={colors.lime}>
              Create an account
            </Text>
          </Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/owner-sign-up')} style={styles.ownerLink} hitSlop={8}>
          <Text variant="body" color={colors.textOnDarkMuted}>
            Own a turf? Join as an owner
          </Text>
          <ArrowUpRight size={16} color={colors.textOnDarkMuted} />
        </Pressable>
        <Text variant="caption" color={colors.textOnDarkMuted} align="center">
          Terms of service · Privacy policy
        </Text>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[5] },
  forgot: { alignSelf: 'flex-end', marginTop: -space[2] },
  links: { gap: space[5], alignItems: 'center', marginTop: space[3] },
  ownerLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
