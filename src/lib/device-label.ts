import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { setDeviceLabel } from '@/features/api/http';

/** e.g. "Pixel 8 · Android 15" or "iPhone 15 Pro · iOS 18.1", shown under Signed-in devices. */
export function installDeviceLabel() {
  if (Platform.OS === 'web') return setDeviceLabel('Web browser');
  const os = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Device.osVersion ?? ''}`.trim();
  setDeviceLabel(`${Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')} · ${os}`);
}
