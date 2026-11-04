import { Image, type ImageProps } from 'expo-image';
import { ImageIcon } from 'lucide-react-native';
import { StyleSheet, View, type ImageSourcePropType, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme/tokens';

type Props = Omit<ImageProps, 'source' | 'style'> & {
  source: ImageSourcePropType | string | null | undefined;
  style?: StyleProp<ViewStyle>;
  rounded?: number;
};

/**
 * Every photo goes through here: memory+disk cache, a soft fade, recycling for
 * lists, and a branded placeholder when a venue has no photo yet.
 */
export function Photo({ source, style, rounded = radius.md, ...rest }: Props) {
  if (!source) {
    return (
      <View style={[styles.placeholder, { borderRadius: rounded }, style]} accessibilityLabel="Photo coming soon">
        <ImageIcon size={28} color={colors.textSubtle} strokeWidth={1.6} />
      </View>
    );
  }
  return (
    <Image
      source={source as ImageProps['source']}
      cachePolicy="memory-disk"
      transition={180}
      contentFit="cover"
      placeholder={{ blurhash: 'L7F~gc00~qofD%WB9Fof00of%Mj[' }}
      {...rest}
      style={[styles.img, { borderRadius: rounded }, style as StyleProp<ImageStyle>]}
    />
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  placeholder: { backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
});
