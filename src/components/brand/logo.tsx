import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import {
  ICON_ASPECT,
  ICON_BODY,
  ICON_SLASH,
  ICON_VIEWBOX,
  WORDMARK_ASPECT,
  WORDMARK_BODY,
  WORDMARK_SLASH,
  WORDMARK_VIEWBOX,
} from './paths';

type Tone = 'dark' | 'light';

/** "TurfSides" wordmark — vector, matches the splash animation's final frame. */
/** `fill` pins the letters' colour (e.g. on a panel that is light in both themes). */
export function Wordmark({ height = 28, tone = 'dark', fill }: { height?: number; tone?: Tone; fill?: string }) {
  return (
    <Svg
      width={height * WORDMARK_ASPECT}
      height={height}
      viewBox={WORDMARK_VIEWBOX}
      accessibilityRole="image"
      accessibilityLabel="TurfSides">
      <Path d={WORDMARK_BODY} fill={fill ?? (tone === 'dark' ? colors.ink : colors.textOnDark)} />
      <Path d={WORDMARK_SLASH} fill={colors.orange} />
    </Svg>
  );
}

/** "TS" app mark. */
export function LogoMark({ height = 32, tone = 'dark' }: { height?: number; tone?: Tone }) {
  return (
    <Svg width={height * ICON_ASPECT} height={height} viewBox={ICON_VIEWBOX} accessibilityLabel="TurfSides">
      <Path d={ICON_BODY} fill={tone === 'dark' ? colors.ink : colors.textOnDark} />
      <Path d={ICON_SLASH} fill={colors.orange} />
    </Svg>
  );
}
