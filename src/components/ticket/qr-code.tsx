import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
// Pure encoder (no canvas/DOM) — keeps the bundle small.
import QRCodeCore from 'qrcode/lib/core/qrcode';

import { radius } from '@/theme/tokens';

const QR_BG = '#FFFFFF';
const QR_FG = '#161B1D';

/** Renders a QR as one SVG path (fast: a single native draw call). */
export function QRCode({ value, size = 120 }: { value: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = QRCodeCore.create(value, { errorCorrectionLevel: 'M' });
    const count: number = qr.modules.size;
    const data: Uint8Array = qr.modules.data;
    let path = '';
    for (let y = 0; y < count; y++) {
      let run = -1;
      for (let x = 0; x <= count; x++) {
        const on = x < count && data[y * count + x];
        if (on && run < 0) run = x;
        if (!on && run >= 0) {
          path += `M${run} ${y}h${x - run}v1h${run - x}z`;
          run = -1;
        }
      }
    }
    return { d: path, n: count };
  }, [value]);

  const pad = 2;
  return (
    // Always black on white, in both themes: scanners need a light background (and the
    // dark theme's surface is almost the colour of the modules).
    <View style={{ backgroundColor: QR_BG, borderRadius: radius.sm, padding: 6 }} accessibilityLabel="Entry pass QR code">
      <Svg width={size} height={size} viewBox={`${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`}>
        <Path d={d} fill={QR_FG} />
      </Svg>
    </View>
  );
}
