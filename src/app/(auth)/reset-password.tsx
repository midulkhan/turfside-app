import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, LockKeyhole } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { errorMessage } from '@/features/session/pending-signup';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { isStrongPassword } from '@/lib/validation';
import { colors, gutter, radius, space } from '@/theme/tokens';

/** Step 2 of password reset: SMS code + new password. Signs out every other device. */
export default function ResetPassword() {
  const { phone = '', devCode = '' } = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const codeError = submitted && !/^\d{6}$/.test(code) ? 'Enter the 6-digit code.' : undefined;
  const pwError = submitted && !isStrongPassword(password) ? 'Use at least 8 characters.' : undefined;
  const masked = phone.length === 10 ? `+880 ${phone.slice(0, 4)} ••• ${phone.slice(-3)}` : 'your number';

  const submit = async () => {
    setSubmitted(true);
    if (!/^\d{6}$/.test(code) || !isStrongPassword(password)) {
      haptic.error();
      return;
    }
    setLoading(true);
    try {
      const auth = await api.resetVerify(phone, code, password);
      haptic.success();
      await signIn(auth);
      router.replace('/explore');
    } catch (e) {
      haptic.error();
      Alert.alert('Couldn’t reset password', errorMessage(e));
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <View style={styles.top}>
          <IconButton icon={ArrowLeft} label="Go back" variant="dark" onPress={() => router.back()} style={styles.back} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.badge}>
            <LockKeyhole size={26} color={colors.ink} strokeWidth={2} />
          </View>
          <Text variant="h1" color={colors.textOnDark}>
            New password
          </Text>
          <Text variant="body" color={colors.textOnDarkMuted}>
            If {masked} has an account, we’ve texted it a 6-digit code.
          </Text>
          <Input
            tone="dark"
            label="Code"
            placeholder="6-digit code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            error={codeError}
            hint={devCode ? `Test code: ${devCode}` : undefined}
          />
          <PasswordInput
            tone="dark"
            label="New password"
            placeholder="Create a password"
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            maxLength={128}
            hint="At least 8 characters. You’ll be signed out on other devices."
            error={pwError}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Button label="Save and sign in" onPress={submit} loading={loading} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  top: { paddingHorizontal: gutter, paddingTop: space[2] },
  back: { borderColor: colors.borderOnDark, backgroundColor: colors.inkRaised },
  body: { paddingHorizontal: gutter, gap: space[4], paddingTop: space[6], paddingBottom: space[8] },
  badge: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
});
