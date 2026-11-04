import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';

import { Text } from './text';

export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, size = 48, ring, uri }: { name: string; size?: number; ring?: string; uri?: string | null }) {
  if (uri) {
    return (
      <Image
        source={uri}
        accessibilityLabel={name}
        cachePolicy="memory-disk"
        transition={150}
        style={[styles.base, { width: size, height: size, borderRadius: size / 2 }, ring ? { borderWidth: 2, borderColor: ring } : null]}
      />
    );
  }
  return (
    <View
      style={[styles.base, { width: size, height: size, borderRadius: size / 2 }, ring ? { borderWidth: 2, borderColor: ring } : null]}
      accessibilityLabel={name}>
      <Text variant={size >= 48 ? 'title' : 'caption'} style={{ fontSize: size * 0.36 }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/** Overlapping avatar stack ("Need more players?" tile). */
export function AvatarStack({ names, size = 40 }: { names: string[]; size?: number }) {
  return (
    <View style={styles.stack}>
      {names.map((n, i) => (
        <View key={n} style={{ marginLeft: i === 0 ? 0 : -size * 0.32, zIndex: names.length - i }}>
          <Avatar name={n} size={size} ring={colors.surface} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.limeTint, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
