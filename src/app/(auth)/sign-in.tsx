import { router, useLocalSearchParams } from 'expo-router';
import { LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Alert } from '@/components/ui/dialog';
import { AuthShell } from '@/components/auth/auth-shell';
import { SocialButtons } from '@/components/auth/social-buttons';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { errorMessage } from '@/features/session/pending-signup';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { isStrongPassword, normaliseIdentifier } from '@/lib/validation';
import { colors, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

export default function SignIn() {
  const { signIn } = useSession();
  // Arriving from sign-up's "already has an account": the number or email is filled in.
  const { identifier } = useLocalSearchParams<{ identifier?: string }>();
  const [id, setId] = useState(identifier ?? '');
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
    try {
      const auth = await api.login(ident.value, password);
      haptic.success();
      await signIn(auth);
      router.replace('/explore');
    } catch (e) {
      haptic.error();
      Alert.alert('Couldn’t sign in', errorMessage(e));
    } finally {
      setLoading(false);
    }
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
        <Text variant="caption" color={colors.textOnDarkMuted} align="center">
          Terms of service · Privacy policy
        </Text>
      </View>
    </AuthShell>
  );
}

const styles = createStyles(() => ({
  form: { gap: space[5] },
  forgot: { alignSelf: 'flex-end', marginTop: -space[2] },
  links: { gap: space[5], alignItems: 'center', marginTop: space[3] },
}));
