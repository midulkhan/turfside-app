import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';

import { Alert } from '@/components/ui/dialog';
import { haversineKm, KNOWN_AREAS } from '@/lib/places';

import { useSession } from './session';

/** Coordinates are rounded to ~100 m: better cache hits, and we never send a precise position. */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turn coordinates into a short "Area, City" label with the phone's own
 * geocoder (Apple / Google Play services, no paid API). Falls back to the
 * nearest known Dhaka area if the geocoder has nothing or is offline.
 */
export async function describePlace(lat: number, lng: number): Promise<{ name: string; city: string; full: string }> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (a) {
      const name = a.district || a.subregion || a.name || a.street || a.city;
      const city = a.city || a.region || a.country || '';
      if (name) {
        const full = [a.name && a.name !== name ? a.name : a.street, name, city].filter(Boolean).join(', ');
        return { name, city: city && city !== name ? city : '', full };
      }
    }
  } catch {
    // offline / rate-limited: use the fallback below
  }
  const nearest = [...KNOWN_AREAS].sort((x, y) => haversineKm(lat, lng, x.lat, x.lng) - haversineKm(lat, lng, y.lat, y.lng))[0];
  return { name: nearest.name, city: nearest.city, full: `Near ${nearest.name}, ${nearest.city}` };
}

/** Ask for permission (once) and get a position: last-known first (instant), then a fresh fix. */
export async function currentPosition() {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Location is off',
      'Allow location to see turfs near you, or set your location on the map.',
      canAskAgain
        ? [{ text: 'OK' }]
        : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
    );
    return null;
  }
  const pos =
    (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 300 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export function useLocate() {
  const { setPlace } = useSession();
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const pos = await currentPosition();
      if (!pos) return false;
      const lat = round3(pos.lat);
      const lng = round3(pos.lng);
      const label = await describePlace(lat, lng);
      setPlace({ name: label.name, city: label.city, lat, lng, source: 'gps' });
      return true;
    } catch {
      Alert.alert('Couldn’t get your location', 'Check that location services are on, or set your location on the map.');
      return false;
    } finally {
      setLocating(false);
    }
  }, [setPlace]);

  return { locate, locating };
}
