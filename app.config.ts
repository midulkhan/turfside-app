import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with values that must not be committed, plus one build switch.
 * GOOGLE_MAPS_ANDROID_API_KEY: Google Maps SDK for Android key (the map picker on Android).
 * iOS uses Apple Maps and needs no key.
 * IOS_FREE_SIGNING=1: for installing on your own iPhone with a free Apple ID (Xcode
 *   "Personal Team"). Free accounts can't sign the Push Notifications capability, so that
 *   build leaves the notifications plugin out (the app runs fine; it just gets no pushes).
 *   Normal and EAS builds are unchanged.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const freeSigning = process.env.IOS_FREE_SIGNING === '1';
  return {
    ...config,
    android: {
      ...config.android,
      ...(key ? { config: { ...config.android?.config, googleMaps: { apiKey: key } } } : {}),
    },
    ...(freeSigning
      ? { plugins: (config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-notifications') }
      : {}),
  } as ExpoConfig;
};
