import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Two stores, on purpose:
 *  - secure: auth/refresh tokens and anything identifying → Keychain / Keystore.
 *  - prefs: non-sensitive flags and cache → AsyncStorage.
 */
export const secure = {
  async get(key: string) {
    if (Platform.OS === 'web') return null; // tokens are httpOnly cookies on web
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === 'web') return;
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  },
  async remove(key: string) {
    if (Platform.OS === 'web') return;
    await SecureStore.deleteItemAsync(key);
  },
};

export const prefs = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  remove: (key: string) => AsyncStorage.removeItem(key),
};
