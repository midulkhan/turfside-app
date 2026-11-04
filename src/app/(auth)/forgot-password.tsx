import { router } from 'expo-router';
import { ArrowLeft, KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { PhoneInput } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { isBdMobile } from '@/lib/validation';
import { colors, gutter, radius, space } from '@/theme/tokens';

export default function ForgotPassword() {
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.top}>
        <IconButton icon={ArrowLeft} label="Go back" variant="dark" onPress={() => router.back()} style={styles.back} />
      </View>
      <View style={styles.body}>
        <View style={styles.badge}>
          <KeyRound size={26} color={colors.ink} strokeWidth={2} />
        </View>
        <Text variant="h1" color={colors.textOnDark}>
          Reset password
        </Text>
        <Text variant="body" color={colors.textOnDarkMuted}>
          We’ll text a code to your mobile number. For your security we show the same message whether or not an account exists.
        </Text>
        <PhoneInput
          tone="dark"
          label="Mobile number"
          value={phone}
          onChangeText={setPhone}
          error={touched && !isBdMobile(phone) ? 'Enter a valid 10-digit mobile number.' : undefined}
        />
        <Button
          label="Send code"
          onPress={() => {
            setTouched(true);
            if (isBdMobile(phone)) router.push({ pathname: '/verify', params: { phone, role: 'player' } });
          }}
        />
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
});
