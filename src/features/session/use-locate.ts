import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { haversineKm, KNOWN_AREAS } from '@/features/api/mock-db';

import { useSession } from './session';

/**
 * GPS without paid map APIs: last-known position first (instant), then a
 * balanced-accuracy fix. Coordinates are rounded to ~100 m before use, which
 * improves cache hits and avoids sending precise location to the server.
 * The area label comes from our own known-areas list (no geocoding API).
 */
export function useLocate() {
  const { setPlace } = useSession();
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location is off', 'Pick your area from the list instead, or allow location in Settings.');
        return false;
      }
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000, requiredAccuracy: 500 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const lat = Math.round(pos.coords.latitude * 1000) / 1000;
      const lng = Math.round(pos.coords.longitude * 1000) / 1000;
      const nearest = [...KNOWN_AREAS].sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))[0];
      setPlace({ name: nearest.name, city: nearest.city, lat, lng, source: 'gps' });
      return true;
    } catch {
      Alert.alert('Could not get your location', 'Pick your area from the list instead.');
      return false;
    } finally {
      setLocating(false);
    }
  }, [setPlace]);

  return { locate, locating };
}
