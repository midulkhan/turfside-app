import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
  Geist_800ExtraBold_Italic,
  useFonts,
} from '@expo-google-fonts/geist';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { VideoSplash } from '@/components/splash/video-splash';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { OverlayProvider } from '@/components/ui/overlay-host';
import { installDeviceLabel } from '@/lib/device-label';
import { installNavGuard } from '@/lib/nav-guard';
import { SessionProvider, useSession } from '@/features/session/session';
import { persistOptions, queryClient } from '@/lib/query-client';
import { colors } from '@/theme/tokens';
import { ThemeProvider, themedScreen, useTheme } from '@/theme/theme-provider';
import { createStyles } from '@/theme/styles';

installNavGuard(); // one tap = one screen, even on a fast double tap
installDeviceLabel();

SplashScreen.preventAutoHideAsync().catch(() => {});

// The intro plays once per launch, even when the screens re-mount for a theme switch.
let splashPlayed = false;

function RootNavigator() {
  const { ready, user } = useSession();
  const { scheme } = useTheme(); // re-render on a theme switch; screens re-mount via screenLayout
  const [splashDone, setSplashDone] = useState(splashPlayed);
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_800ExtraBold,
    Geist_800ExtraBold_Italic,
    'Taka-Medium': require('@/assets/fonts/Taka-Medium.ttf'),
    'Taka-Bold': require('@/assets/fonts/Taka-Bold.ttf'),
    'Taka-ExtraBold': require('@/assets/fonts/Taka-ExtraBold.ttf'),
  });
  const appReady = ready && (fontsLoaded || !!fontError);
  const finishSplash = useCallback(() => {
    splashPlayed = true;
    setSplashDone(true);
  }, []);

  return (
    <>
      {appReady ? (
        <Stack
          screenLayout={themedScreen(scheme, ['(tabs)'])}
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'ios_from_right' }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Protected guard={!user} redirectTo="/">
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={!!user} redirectTo="/">
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="venue/[id]" />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="booking/[id]" options={{ gestureEnabled: false, animation: 'fade_from_bottom' }} />
            <Stack.Screen name="search" options={{ animation: 'fade' }} />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="requests" />
            <Stack.Screen name="locations" options={{ animation: 'slide_from_bottom', gestureDirection: 'vertical' }} />
            <Stack.Screen name="pick-location" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="payment-return" options={{ animation: 'none' }} />
            <Stack.Screen name="privacy" />
          </Stack.Protected>
        </Stack>
      ) : null}
      {appReady ? <OfflineBanner key={scheme} /> : null}
      {!splashDone ? <VideoSplash appReady={appReady} onDone={finishSplash} /> : null}
    </>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <SessionProvider>
            <ThemeProvider>
              <ThemedStatusBar />
              {/* whole app = Android blur source; full-screen overlays render above it */}
              <OverlayProvider>
                <RootNavigator />
              </OverlayProvider>
            </ThemeProvider>
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = createStyles(() => ({ root: { flex: 1, backgroundColor: colors.bg } }));
