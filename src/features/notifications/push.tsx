import { useQueryClient } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import * as api from '@/features/api/client';
import { qk } from '@/features/api/queries';
import { useSession } from '@/features/session/session';
import { prefs } from '@/lib/storage';

import { notificationTarget, type NotificationData } from './open';

/**
 * Push notifications (booking, payment and squad news), sent by the server through Expo's
 * push service. Needs a development or store build: Expo Go on Android has no push (SDK 53+).
 */
const supported =
  Platform.OS !== 'web' &&
  Device.isDevice &&
  !(Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient);

const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

// While the app is open, still show the banner (the list and the bell refresh live as well).
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

const TOKEN_KEY = 'ts.pushToken';

/** Ask once, get this phone's token and hand it to the server. Quietly does nothing if it can't. */
async function register(): Promise<string | null> {
  if (!supported || !projectId) return null;
  if (Platform.OS === 'android') {
    // Must exist before the permission prompt on Android 13+; `channelId: 'default'` on the server.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Bookings and squads',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#DDF65A',
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  await prefs.set(TOKEN_KEY, token);
  return token;
}

/**
 * Mount once inside the signed-in app (after navigation is ready):
 * registers the device, keeps the in-app list live, and opens the right screen on a tap.
 */
export function PushManager() {
  const { user } = useSession();
  const qc = useQueryClient();
  const userId = user?.id;

  // Register after every sign-in (tokens can change; the server ties it to this login).
  useEffect(() => {
    if (!userId) return;
    register().catch(() => {});
  }, [userId]);

  // A push arrived while the app is open: refresh the bell, the list, and what it's about.
  useEffect(() => {
    if (!supported) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const d = n.request.content.data as NotificationData | undefined;
      void qc.invalidateQueries({ queryKey: qk.notifications });
      if (d?.matchId) void qc.invalidateQueries({ queryKey: ['match', d.matchId] });
      if (d?.kind === 'payment' || d?.kind === 'booking') void qc.invalidateQueries({ queryKey: ['bookings'] });
    });
    return () => sub.remove();
  }, [qc]);

  // Tapped a push (also the one that launched the app): open what it is about, once.
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const d = last.notification.request.content.data as NotificationData | undefined;
    void qc.invalidateQueries({ queryKey: qk.notifications });
    const go = notificationTarget(d);
    // Let the screen behind settle first (cold start: the first screen is still mounting).
    setTimeout(() => (go ? go() : router.push('/notifications')), 250);
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [last, userId, qc]);

  return null;
}

