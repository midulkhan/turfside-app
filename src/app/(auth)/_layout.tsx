import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export const unstable_settings = { anchor: 'sign-in' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.ink } }} />;
}
