import { Stack } from 'expo-router';

import { themedScreen, useTheme } from '@/theme/theme-provider';
import { colors } from '@/theme/tokens';

export const unstable_settings = { anchor: 'sign-in' };

export default function AuthLayout() {
  const { scheme } = useTheme();
  return (
    <Stack
      screenLayout={themedScreen(scheme)}
      // Dark status bar icons over the sign-in header, which is light in both themes.
      screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.deep }, statusBarStyle: 'dark' }}
    />
  );
}
