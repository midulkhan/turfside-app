import { Maximize2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { haptic } from '@/lib/haptics';
import { colors, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

import { QRCode, QRPopup } from './qr-code';

/**
 * The dark "Your entry pass" strip: booking code on the left, a tappable QR on the right that
 * opens full screen. Same design as the ticket page; `framed` puts it in the white card edge
 * used when it stands on its own (e.g. a squad you joined).
 */
export function EntryPass({
  code,
  passToken,
  title,
  subtitle,
  framed,
}: {
  code: string;
  passToken: string;
  /** Shown in the full-screen QR. */
  title: string;
  subtitle: string;
  framed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const strip = (
    <View style={styles.pass}>
      <View style={styles.flex}>
        <View style={styles.badge}>
          <Text variant="caption" style={styles.badgeText}>
            YOUR ENTRY PASS
          </Text>
        </View>
        <Text variant="h2" color={colors.textOnDark} style={styles.code} adjustsFontSizeToFit numberOfLines={1}>
          {code}
        </Text>
        <Text variant="label" color={colors.textOnDarkMuted}>
          Show this code at reception
        </Text>
      </View>
      <View style={styles.rule} />
      <Pressable
        onPress={() => {
          haptic.select();
          setOpen(true);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Enlarge entry pass QR code"
        style={({ pressed }) => [styles.qrTap, pressed && styles.qrPressed]}>
        <QRCode value={passToken} size={84} />
        <View style={styles.expand}>
          <Maximize2 size={12} color={colors.charcoal} strokeWidth={2.6} />
        </View>
      </Pressable>
    </View>
  );
  return (
    <>
      {framed ? <View style={styles.frame}>{strip}</View> : strip}
      <QRPopup visible={open} value={passToken} code={code} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = createStyles(() => ({
  flex: { flex: 1 },
  frame: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  pass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: colors.inverse,
    borderRadius: radius.md,
    padding: space[4],
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    marginBottom: space[2],
  },
  badgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1.6, color: colors.charcoal },
  code: { fontFamily: 'Geist_700Bold', fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  rule: { width: 1, alignSelf: 'stretch', backgroundColor: colors.borderOnDark },
  qrTap: { position: 'relative' },
  qrPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  expand: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
