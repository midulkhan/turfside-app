import { WifiOff } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOffline } from '@/lib/network';
import { colors, radius, shadow, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { Text } from './text';

/** Small pill under the status bar while the device is offline. Taps pass through. */
export function OfflineBanner() {
  const offline = useOffline();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + space[2] }]}>
      <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={[styles.pill, shadow.float]}>
        <WifiOff size={14} color={colors.lime} strokeWidth={2} />
        <Text variant="caption" color={colors.textOnDark}>
          You’re offline · showing saved info
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = createStyles(() => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.inverse,
  },
}));
