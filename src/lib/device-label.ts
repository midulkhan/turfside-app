import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { setDeviceLabel, setInstallId } from '@/features/api/http';
import { newIdempotencyKey } from '@/lib/ids';
import { prefs } from '@/lib/storage';

/** e.g. "Pixel 8 · Android 15" or "iPhone 15 Pro · iOS 18.1", shown under Signed-in devices. */
export function installDeviceLabel() {
  // This install's id (made once, kept): a fresh one at once, the saved one as soon as it's read.
  const fresh = newIdempotencyKey();
  setInstallId(fresh);
  prefs
    .get('ts.install')
    .then((saved) => (saved ? setInstallId(saved) : prefs.set('ts.install', fresh)))
    .catch(() => {});
  if (Platform.OS === 'web') return setDeviceLabel('Web browser');
  const os = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Device.osVersion ?? ''}`.trim();
  setDeviceLabel(`${Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')} · ${os}`);
}
