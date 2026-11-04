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
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { VideoSplash } from '@/components/splash/video-splash';
import { SessionProvider, useSession } from '@/features/session/session';
import { persistOptions, queryClient } from '@/lib/query-client';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { ready, user } = useSession();
  const [splashDone, setSplashDone] = useState(false);
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
  const finishSplash = useCallback(() => setSplashDone(true), []);

  return (
    <>
      {appReady ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'ios_from_right' }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Protected guard={!user} redirectTo="/">
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={!!user} redirectTo="/">
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="venue/[id]" />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="cart" />
            <Stack.Screen name="booking/[id]" options={{ gestureEnabled: false, animation: 'fade_from_bottom' }} />
            <Stack.Screen name="search" options={{ animation: 'fade' }} />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="requests" />
            <Stack.Screen name="locations" options={{ animation: 'slide_from_bottom', gestureDirection: 'vertical' }} />
            <Stack.Screen name="pick-location" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="payment-return" options={{ animation: 'none' }} />
          </Stack.Protected>
        </Stack>
      ) : null}
      {!splashDone ? <VideoSplash appReady={appReady} onDone={finishSplash} /> : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <SessionProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#FFFFFF' } });
