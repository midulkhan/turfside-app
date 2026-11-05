import { createContext, use, useId, useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Pattern, Rect } from 'react-native-svg';

import { colors, radius as radii } from '@/theme/tokens';

/**
 * Ticket outline as a single SVG path, built from the brand ticket artwork
 * (assets/brand/ticket-icon.svg): rounded corners and a soft, curved "bite"
 * on each side at `cy`. In the artwork the bite is 140 tall and 74 deep with
 * Bézier handles at 41/31, so here it scales from `n` (half the bite height)
 * with the same proportions — the corners and the line never stretch.
 */
export function ticketPath(w: number, h: number, r: number, n: number, cy: number, inset = 0) {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const R = Math.min(r, (w - inset * 2) / 2, (h - inset * 2) / 2);
  const k = n / 70; // artwork units → px
  const d = 74 * k; // bite depth
  const hx = 41 * k; // horizontal handle
  const hy = 31 * k; // vertical handle
  const c = Math.min(Math.max(cy, y0 + R + n), y1 - R - n);
  return [
    `M${x0 + R} ${y0}`,
    `H${x1 - R}`,
    `Q${x1} ${y0} ${x1} ${y0 + R}`,
    `V${c - n}`,
    `C${x1 - hx} ${c - n} ${x1 - d} ${c - n + hy} ${x1 - d} ${c}`,
    `C${x1 - d} ${c + n - hy} ${x1 - hx} ${c + n} ${x1} ${c + n}`,
    `V${y1 - R}`,
    `Q${x1} ${y1} ${x1 - R} ${y1}`,
    `H${x0 + R}`,
    `Q${x0} ${y1} ${x0} ${y1 - R}`,
    `V${c + n}`,
    `C${x0 + hx} ${c + n} ${x0 + d} ${c + n - hy} ${x0 + d} ${c}`,
    `C${x0 + d} ${c - n + hy} ${x0 + hx} ${c - n} ${x0} ${c - n}`,
    `V${y0 + R}`,
    `Q${x0} ${y0} ${x0 + R} ${y0}`,
    'Z',
  ].join('');
}

type ShapeProps = {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  notch?: number;
  /** Notch centre from the top. Defaults to the vertical middle. */
  notchY?: number;
  hatch?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const ReportNotch = createContext<((y: number) => void) | null>(null);

/**
 * Container that paints itself as a ticket. Put a <TicketDivider/> inside it
 * (as a direct child) to place the notches on the tear line automatically.
 */
export function TicketSurface({ fill, stroke, strokeWidth = 1, radius = radii.md, notch = 7, notchY, hatch, style, children }: ShapeProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dividerY, setDividerY] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ''); // unique SVG ids (web shares one id space)
  const onLayout = (e: LayoutChangeEvent) => {
    // Snap to whole device pixels, never larger than the view (Android clips
    // anything past its bounds) and tolerant of float error (112.3636 × 2.75 =
    // 308.9999 must stay 309, not drop a pixel).
    const pr = PixelRatio.get();
    const width = Math.floor(e.nativeEvent.layout.width * pr + 0.01) / pr;
    const height = Math.floor(e.nativeEvent.layout.height * pr + 0.01) / pr;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const cy = notchY ?? dividerY ?? size.h / 2;
  // Line width in whole device pixels (1pt on a 2.75x screen would smear across
  // three pixel columns unevenly), so every side is equally crisp.
  const pr = PixelRatio.get();
  const sw = stroke ? Math.max(1, Math.round(strokeWidth * pr)) / pr : 0;
  // +1 device-pixel margin on every side, so pixel snapping can never shave an edge.
  const d = size.w ? ticketPath(size.w, size.h, radius, notch, cy, sw / 2 + 1 / pr) : '';

  return (
    <View style={style} onLayout={onLayout}>
      {size.w ? (
        // Pinned to the view's edges and drawn through a viewBox: if a measurement is a
        // hair stale, the outline scales by a fraction of a pixel instead of being clipped.
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none">
          {hatch ? (
            <Defs>
              <Pattern id={`h${uid}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <Line x1="0" y1="0" x2="0" y2="9" stroke={colors.borderStrong} strokeWidth="1.4" />
              </Pattern>
              <ClipPath id={`c${uid}`}>
                <Path d={d} />
              </ClipPath>
            </Defs>
          ) : null}
          <Path d={d} fill={fill} />
          {hatch ? (
            <G clipPath={`url(#c${uid})`}>
              <Rect width={size.w} height={size.h} fill={`url(#h${uid})`} opacity={0.55} />
            </G>
          ) : null}
          {stroke ? <Path d={d} fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" /> : null}
        </Svg>
      ) : null}
      <ReportNotch value={setDividerY}>{children}</ReportNotch>
    </View>
  );
}

/** Dashed tear line. As a direct child of <TicketSurface/> it also positions the notches. */
export function TicketDivider({
  inset = 22,
  dashColor = colors.borderStrong,
  gap = 14,
}: {
  inset?: number;
  dashColor?: string;
  gap?: number;
}) {
  const report = use(ReportNotch);
  return (
    <View
      style={{ height: gap * 2, justifyContent: 'center' }}
      onLayout={(e) => report?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height / 2)}>
      <View style={{ borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: dashColor, marginHorizontal: inset }} />
    </View>
  );
}

