import { onlineManager } from '@tanstack/react-query';
import { requireOptionalNativeModule } from 'expo';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Connectivity → React Query. While offline, queries pause instead of failing
 * one by one; the moment the connection is back they refetch on their own.
 *
 * expo-network is native: on a build made before it was added the module is
 * missing, so we check first and simply stay "online" (the old behaviour).
 */
export function initNetwork() {
  if (Platform.OS === 'web' || !requireOptionalNativeModule('ExpoNetwork')) {
    onlineManager.setOnline(true);
    return;
  }
  // Loaded lazily, only once we know the native side exists.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Network = require('expo-network') as typeof import('expo-network');
  const apply = (s: { isConnected?: boolean; isInternetReachable?: boolean }) =>
    // isInternetReachable can be undefined while probing: trust isConnected then.
    onlineManager.setOnline(s.isInternetReachable ?? s.isConnected ?? true);
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((s) => setOnline(s.isInternetReachable ?? s.isConnected ?? true));
    return () => sub.remove();
  });
  Network.getNetworkStateAsync().then(apply, () => onlineManager.setOnline(true));
}

/** true while the device has no usable connection. */
export function useOffline() {
  return !useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
