import { Children, type ReactNode } from 'react';
import { Text as RNText, StyleSheet, type TextProps } from 'react-native';

import { colors, font, type TypeVariant, type } from '@/theme/tokens';

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

/**
 * Geist has no "৳" glyph. We ship a ~1.4 KB subset of Noto Sans Bengali that
 * contains only ৳ and swap it in automatically, weight-matched, wherever a
 * string contains the taka sign.
 */
const TAKA_FONT: Record<string, string> = {
  [font.regular]: 'Taka-Medium',
  [font.medium]: 'Taka-Medium',
  [font.semibold]: 'Taka-Bold',
  [font.bold]: 'Taka-Bold',
  [font.extrabold]: 'Taka-ExtraBold',
  [font.extraboldItalic]: 'Taka-ExtraBold',
};

function withTaka(children: ReactNode, family: string): ReactNode {
  const swap = (s: string, key: number) => {
    if (!s.includes('৳')) return s;
    return s.split('৳').flatMap((part, i) =>
      i === 0
        ? [part]
        : [
            <RNText key={`${key}-${i}`} style={{ fontFamily: TAKA_FONT[family] ?? 'Taka-Bold' }}>
              ৳
            </RNText>,
            part,
          ],
    );
  };
  if (typeof children === 'string') return swap(children, 0);
  if (Array.isArray(children)) return Children.map(children, (c, i) => (typeof c === 'string' ? swap(c, i) : c));
  return children;
}

/** The only text primitive used in the app — keeps the type scale consistent. */
export function Text({ variant = 'body', color = colors.text, align, style, children, ...rest }: AppTextProps) {
  const family = (StyleSheet.flatten(style)?.fontFamily as string | undefined) ?? type[variant].fontFamily;
  return (
    <RNText maxFontSizeMultiplier={1.4} {...rest} style={[type[variant], { color }, align && { textAlign: align }, style]}>
      {withTaka(children, family)}
    </RNText>
  );
}
