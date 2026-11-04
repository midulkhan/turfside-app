import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with values that must not be committed.
 * GOOGLE_MAPS_ANDROID_API_KEY: Google Maps SDK for Android key (the map picker on Android).
 * iOS uses Apple Maps and needs no key.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  return {
    ...config,
    android: {
      ...config.android,
      ...(key ? { config: { ...config.android?.config, googleMaps: { apiKey: key } } } : {}),
    },
  } as ExpoConfig;
};
