import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

export type CardProps = ViewProps & { padded?: boolean; tone?: 'surface' | 'lime' | 'dark' | 'limeSoft'; elevated?: boolean };

const bg = { surface: colors.surface, lime: colors.lime, dark: colors.ink, limeSoft: colors.limeSoft };
const bd = { surface: colors.border, lime: colors.lime, dark: colors.ink, limeSoft: colors.limeTint };

/** Every surface in the app: radius.lg, 1px border, optional soft shadow. */
export function Card({ padded = true, tone = 'surface', elevated, style, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[styles.base, { backgroundColor: bg[tone], borderColor: bd[tone] }, padded && styles.padded, elevated && shadow.card, style]}
    />
  );
}

export function Divider({ dashed, dark, style }: { dashed?: boolean; dark?: boolean; style?: ViewProps['style'] }) {
  return <View style={[dashed ? styles.dashed : styles.line, { borderColor: dark ? colors.borderOnDark : colors.border }, style]} />;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, borderWidth: 1 },
  padded: { padding: space[4] },
  line: { borderTopWidth: 1, alignSelf: 'stretch' },
  dashed: { borderTopWidth: 1.5, borderStyle: 'dashed', alignSelf: 'stretch' },
});
