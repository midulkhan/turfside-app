/**
 * TurfSides design tokens — the single source of truth for every colour,
 * radius, border, spacing step and type style in the app.
 *
 * Rules (keep the UI consistent):
 *  - Never hard-code a colour, radius or font size in a screen. Import from here.
 *  - Controls (buttons, inputs, chips, search) are always pill-shaped.
 *  - Surfaces (cards, sheets, tiles) use radius.lg; images inside a card use radius.md.
 *  - Borders are always 1px using colors.border (light) or colors.borderOnDark (dark).
 *  - Lime is for primary actions, active states and pins only. Orange is brand accent only.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Light palette (the original "Floodlight" look). */
const light = {
  // Brand — "Floodlight" palette
  ink: '#161B1D', // primary text and icons (flips to near-white in dark mode)
  inverse: '#161B1D', // strong dark surfaces: tab bar, price bar, primary buttons, selected ticket
  charcoal: '#161B1D', // text/icons on lime and other always-light fills (same in both themes)
  deep: '#161B1D', // sign-in screens' dark panel (stays the darkest tone in both themes)
  authTop: '#F4F5F0', // sign-in screens' upper panel
  inkRaised: '#20272A', // raised dark surfaces (inputs on dark)
  inkMuted: '#2C3437',
  lime: '#DDF85C',
  limeSoft: '#F3FCCB', // lime tint backgrounds
  limeTint: '#E9FA9A',
  limeText: '#4E6B00', // lime-family text readable on the page (4.5:1+)
  orange: '#FF5A1F',

  // Neutrals
  bg: '#F4F5F0', // chalk app background
  surface: '#FFFFFF',
  surfaceMuted: '#ECEEE8',
  text: '#161B1D',
  textMuted: '#5C6468',
  textSubtle: '#858D91',
  textOnDark: '#FFFFFF',
  textOnDarkMuted: '#A9B1B4',
  border: '#E2E5DC',
  borderStrong: '#C9CEC3',
  borderOnDark: 'rgba(255,255,255,0.10)',

  // Status
  danger: '#D92D20',
  dangerSoft: '#FEECEB',
  warning: '#B54708',
  warningSoft: '#FFF6E5',
  warningLine: '#F2C46D',
  warningText: '#8A5A00',
  bkash: '#E2136E',
  bkashSoft: '#FFF1F7',
  scrim: 'rgba(22,27,29,0.55)',
  glass: 'rgba(255,255,255,0.78)',
  /** Fully transparent version of `bg`, for fades that end in the page colour. */
  bgClear: 'rgba(244,245,240,0)',
};

/** Dark palette: same roles, tuned for contrast on a near-black page. */
const dark: typeof light = {
  ink: '#EEF1EA',
  inverse: '#262E31',
  charcoal: '#161B1D',
  deep: '#07090A',
  authTop: '#F4F5F0', // sign-in header stays light in dark mode too (dark text on it)
  inkRaised: '#2C3538',
  inkMuted: '#36403F',
  lime: '#DDF85C',
  limeSoft: '#27300F',
  limeTint: '#3A4714',
  limeText: '#C8E64F',
  orange: '#FF6A33',

  bg: '#0E1213',
  surface: '#171C1E',
  surfaceMuted: '#222A2C',
  text: '#EEF1EA',
  textMuted: '#A3ABAE',
  textSubtle: '#7D8689',
  textOnDark: '#FFFFFF',
  textOnDarkMuted: '#A9B1B4',
  border: '#283033',
  borderStrong: '#3A4447',
  borderOnDark: 'rgba(255,255,255,0.10)',

  danger: '#FF6B5E',
  dangerSoft: '#3A1A17',
  warning: '#F5A35C',
  warningSoft: '#33260F',
  warningLine: '#7A5A1E',
  warningText: '#F2C46D',
  bkash: '#F0357F',
  bkashSoft: '#3A1426',
  scrim: 'rgba(0,0,0,0.62)',
  glass: 'rgba(23,28,30,0.78)',
  bgClear: 'rgba(14,18,19,0)',
};

export type Scheme = 'light' | 'dark';
export type Palette = { readonly [K in keyof typeof light]: string };
export const palettes: Record<Scheme, Palette> = { light, dark };

let activeScheme: Scheme = 'light';
let version = 0;
/** The scheme every colour and themed style currently resolves to. */
export const getScheme = () => activeScheme;
/** Switch palettes (the theme provider re-renders the app right after). */
export function applyScheme(s: Scheme) {
  if (s === activeScheme) return;
  activeScheme = s;
  version++;
}
export const themeVersion = () => version;

/** `#RRGGBB` + alpha → rgba(), for fades and frosted fills built from palette colours. */
export function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Live colours: `colors.text` always reads the active palette, so read it at render time. */
export const colors: Palette = Object.defineProperties(
  {},
  Object.fromEntries(Object.keys(light).map((k) => [k, { get: () => palettes[activeScheme][k as keyof Palette], enumerable: true }])),
) as Palette;

export const radius = {
  xs: 8,
  sm: 12,
  md: 18, // images inside cards, slot tickets
  lg: 24, // cards, sheets
  xl: 32,
  pill: 999,
} as const;

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 56,
} as const;

/** Horizontal page gutter used by every screen. */
export const gutter = space[5];

export const size = {
  control: 56, // buttons, inputs
  controlSm: 44, // chips, small buttons (min tap target)
  iconButton: 48,
  tabBar: 64,
  icon: 22,
  iconSm: 18,
} as const;

export const border = {
  width: 1,
} as const;

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  extrabold: 'Geist_800ExtraBold',
  extraboldItalic: 'Geist_800ExtraBold_Italic',
} as const;

type TypeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'>;

export const type = {
  display: { fontFamily: font.extraboldItalic, fontSize: 36, lineHeight: 38, letterSpacing: -1.1 },
  h1: { fontFamily: font.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  /** Tab-screen titles (Bookings, Saved, Profile): lighter and smaller than h1. */
  pageTitle: { fontFamily: font.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  h2: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  h3: { fontFamily: font.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.2 },
  title: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 18 },
  labelStrong: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 16 },
  overline: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 2.2 },
  number: { fontFamily: font.extrabold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5 },
} as const satisfies Record<string, TypeStyle>;

export type TypeVariant = keyof typeof type;

export const shadow: Record<'card' | 'float', ViewStyle> = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#161B1D', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 2 },
    default: { boxShadow: '0 6px 16px rgba(22,27,29,0.06)' },
  })!,
  float: Platform.select<ViewStyle>({
    ios: { shadowColor: '#161B1D', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 10 },
    default: { boxShadow: '0 10px 24px rgba(22,27,29,0.22)' },
  })!,
};

export const motion = {
  fast: 160,
  base: 240,
  slow: 420,
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
} as const;
