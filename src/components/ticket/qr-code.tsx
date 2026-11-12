import { X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
// Pure encoder (no canvas/DOM) — keeps the bundle small.
import QRCodeCore from 'qrcode/lib/core/qrcode';

import { Text } from '@/components/ui/text';
import { radius } from '@/theme/tokens';

const QR_BG = '#FFFFFF';
const QR_FG = '#161B1D';

/** Renders a QR as one SVG path (fast: a single native draw call). */
export function QRCode({ value, size = 120 }: { value: string; size?: number }) {
  const { d, n } = useMemo(() => {
    // Long payloads (the v2 pass carries the whole ticket) use level L: fewer, larger modules,
    // which scan better off a phone screen; a screen doesn't get scratched like paper.
    const qr = QRCodeCore.create(value, { errorCorrectionLevel: value.length > 120 ? 'L' : 'M' });
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

/**
 * The entry pass, large: tap the small QR on a ticket to open it here so reception can scan
 * it from a distance. Tap anywhere or the close button to dismiss.
 */
export function QRPopup({
  visible,
  value,
  code,
  title,
  subtitle,
  onClose,
}: {
  visible: boolean;
  value: string;
  code: string;
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 112, 300);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={popup.scrim}>
        {/* Tap outside the card to close (a layer behind it, so no button sits inside a button). */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close QR code" />
        <View style={popup.card}>
          <View style={popup.head}>
            <View style={popup.flex}>
              <Text variant="title" color={QR_FG} numberOfLines={1}>
                {title}
              </Text>
              <Text variant="label" color="#5C6468" numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={popup.close}>
              <X size={20} color={QR_FG} strokeWidth={2.2} />
            </Pressable>
          </View>
          <QRCode value={value} size={size} />
          <View style={popup.foot}>
            <Text variant="h2" color={QR_FG} style={popup.code} adjustsFontSizeToFit numberOfLines={1}>
              {code}
            </Text>
            <Text variant="label" color="#5C6468" align="center">
              Show this at reception. Turn your screen brightness up if it won’t scan.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Always light, like the QR itself: scanners read dark-on-white best, in both themes.
const popup = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,12,13,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: QR_BG, borderRadius: radius.xl, padding: 20, gap: 16, alignItems: 'center', width: '100%', maxWidth: 380 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
  flex: { flex: 1, minWidth: 0 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ECEEE8', alignItems: 'center', justifyContent: 'center' },
  foot: { gap: 6, alignItems: 'center', alignSelf: 'stretch' },
  code: { letterSpacing: 1 },
});
