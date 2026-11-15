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
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';

import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { VideoSplash } from '@/components/splash/video-splash';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { OverlayProvider } from '@/components/ui/overlay-host';
import { installDeviceLabel } from '@/lib/device-label';
import { installNavGuard } from '@/lib/nav-guard';
import { DialogHost } from '@/components/ui/dialog';
import { PushManager } from '@/features/notifications/push';
import { SessionProvider, useSession } from '@/features/session/session';
import { persistOptions, queryClient } from '@/lib/query-client';
import { colors } from '@/theme/tokens';
import { ThemeProvider, themedScreen, useTheme } from '@/theme/theme-provider';
import { createStyles } from '@/theme/styles';

installNavGuard(); // one tap = one screen, even on a fast double tap
installDeviceLabel();

SplashScreen.preventAutoHideAsync().catch(() => {});
// Safety net: whatever happens at start-up, the native splash never stays up for good.
setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 8000);

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
  // Fonts never hold the app hostage: after a few seconds it opens with system fonts if needed.
  const [fontWaitOver, setFontWaitOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontWaitOver(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const appReady = ready && (fontsLoaded || !!fontError || fontWaitOver);
  const finishSplash = useCallback(() => {
    splashPlayed = true;
    setSplashDone(true);
  }, []);

  return (
    <>
      {appReady ? (
        <Stack
          screenLayout={themedScreen(scheme, ['(tabs)'])}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            // Android: its own native slide (the iOS-style one can flash there on push/back).
            animation: Platform.OS === 'android' ? 'slide_from_right' : 'ios_from_right',
            // iOS takes the status bar style from the screen in front (react-native-screens),
            // not from <StatusBar>, so it is set here per screen as well.
            statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
          }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade', statusBarStyle: 'light' }} />
          <Stack.Protected guard={!user} redirectTo="/">
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={!!user} redirectTo="/">
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            {/* iOS: a quick crossfade. Android's crossfade fades both screens at once (a grey,
                see-through frame mid-way), so there the turf glides up over a solid Explore. */}
            <Stack.Screen
              name="venue/[id]"
              options={Platform.OS === 'android' ? { animation: 'fade_from_bottom' } : { animation: 'fade', animationDuration: 180 }}
            />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="booking/[id]" options={{ gestureEnabled: false, animation: 'fade_from_bottom' }} />
            <Stack.Screen name="search" options={{ animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'fade' }} />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="join" />
            <Stack.Screen name="players" />
            <Stack.Screen name="match/[id]" />
            <Stack.Screen name="game/[id]" />
            <Stack.Screen name="locations" options={{ animation: 'slide_from_bottom', gestureDirection: 'vertical' }} />
            <Stack.Screen name="pick-location" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="payment-return" options={{ animation: 'none' }} />
            <Stack.Screen name="privacy" />
            <Stack.Screen name="edit-profile" />
          </Stack.Protected>
        </Stack>
      ) : null}
      {appReady ? <OfflineBanner key={scheme} /> : null}
      {appReady && user ? <PushManager /> : null}
      {!splashDone ? <VideoSplash appReady={appReady} onDone={finishSplash} /> : null}
    </>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * If anything in the app's start-up throws, show what happened instead of a blank screen.
 * Plain React Native only (no theme or providers), since those may be what failed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#F4F5F0', paddingTop: 64, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#161B1D' }}>Something went wrong</Text>
      <Text style={{ marginTop: 8, fontSize: 15, color: '#5C6468' }}>
        Please try again. If it keeps happening, send us a screenshot of this screen.
      </Text>
      <ScrollView style={{ marginTop: 16, flexGrow: 0, maxHeight: 360 }}>
        <Text selectable style={{ fontSize: 12, color: '#161B1D' }}>
          {String(error?.message ?? error)}
          {'\n\n'}
          {String(error?.stack ?? '').split('\n').slice(0, 12).join('\n')}
        </Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        style={{ marginTop: 20, height: 52, borderRadius: 26, backgroundColor: '#161B1D', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
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
              {/* The app's own popups (replaces the system alert), above everything. */}
              <DialogHost />
            </ThemeProvider>
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = createStyles(() => ({ root: { flex: 1, backgroundColor: colors.bg } }));
