import { CircleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { FullWindowOverlay } from 'react-native-screens';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { haptic } from '@/lib/haptics';
import { createStyles } from '@/theme/styles';
import { colors, radius, space } from '@/theme/tokens';

/**
 * The app's own popup, in place of the system alert. Same call as React Native's Alert, so
 * `Alert.alert(title, message, buttons)` reads the same everywhere; it just looks like TurfSides
 * (theme, fonts, buttons) on iOS, Android and web.
 */
export type DialogButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type Dialog = { id: number; title: string; message?: string; buttons: DialogButton[]; cancelable: boolean };

let seq = 0;
let queue: Dialog[] = [];
const listeners = new Set<(d: Dialog | null) => void>();
const emit = () => listeners.forEach((l) => l(queue[0] ?? null));

export const Alert = {
  alert(title: string, message?: string, buttons?: DialogButton[], options?: { cancelable?: boolean }) {
    const list = buttons?.length ? buttons : [{ text: 'OK' }];
    // Tapping outside closes it when there's a Cancel (or only an OK); never for a lone action.
    const cancelable = options?.cancelable ?? (list.length === 1 || list.some((b) => b.style === 'cancel'));
    queue = [...queue, { id: ++seq, title, message, buttons: list, cancelable }];
    emit();
  },
};

function close(d: Dialog, b?: DialogButton) {
  queue = queue.filter((x) => x.id !== d.id);
  emit();
  // Let the popup leave before the action runs (an action may open the next one).
  if (b?.onPress) setTimeout(b.onPress, 120);
}

/** Mount once, at the root. Shows queued popups one at a time above everything, sheets included. */
export function DialogHost() {
  const [d, setD] = useState<Dialog | null>(queue[0] ?? null);
  useEffect(() => {
    listeners.add(setD);
    return () => {
      listeners.delete(setD);
    };
  }, []);

  useEffect(() => {
    if (!d) return;
    if (d.buttons.length <= 2 && d.buttons.some((b) => b.style === 'destructive')) haptic.warning();
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (d.cancelable) close(d, d.buttons.find((b) => b.style === 'cancel'));
      return true;
    });
    return () => sub.remove();
  }, [d]);

  if (!d) return null;
  const body = <DialogView key={d.id} d={d} />;
  // iOS: an overlay window sits above any open sheet (a second modal can't be presented over
  // one from the root). Android: each Modal is its own window, stacked in order. Web: in-page.
  if (Platform.OS === 'ios') return <FullWindowOverlay>{body}</FullWindowOverlay>;
  if (Platform.OS === 'android')
    return (
      <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {
          if (d.cancelable) close(d, d.buttons.find((b) => b.style === 'cancel'));
        }}>
        {body}
      </Modal>
    );
  return <View style={[StyleSheet.absoluteFill, styles.web]}>{body}</View>;
}

function DialogView({ d }: { d: Dialog }) {
  const cancel = d.buttons.find((b) => b.style === 'cancel');
  // A confirm-to-destroy gets the warning icon; a menu with one destructive choice doesn't.
  const destructive = d.buttons.length <= 2 && d.buttons.some((b) => b.style === 'destructive');
  // Two buttons sit side by side (cancel first); three or more stack, actions on top.
  const ordered = d.buttons.length <= 2 ? [...d.buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0)) : [...d.buttons.filter((b) => b !== cancel), ...(cancel ? [cancel] : [])];
  const row = ordered.length <= 2;

  return (
    <View style={styles.fill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => d.cancelable && close(d, cancel)} accessibilityLabel="Close" accessible={d.cancelable} />
      </Animated.View>
      <Animated.View
        entering={ZoomIn.springify().damping(18).stiffness(260).mass(0.7)}
        exiting={ZoomOut.duration(120)}
        style={styles.card}
        accessibilityViewIsModal
        accessibilityRole="alert">
        {destructive ? (
          <View style={styles.icon}>
            <CircleAlert size={22} color={colors.danger} strokeWidth={2.2} />
          </View>
        ) : null}
        <Text variant="h3" align="center">
          {d.title}
        </Text>
        {d.message ? (
          <Text variant="body" color={colors.textMuted} align="center" style={styles.message}>
            {d.message}
          </Text>
        ) : null}
        <View style={[styles.buttons, row && styles.buttonsRow]}>
          {ordered.map((b, i) => (
            <Button
              key={`${b.text}:${i}`}
              label={b.text ?? 'OK'}
              small
              variant={b.style === 'cancel' ? 'outline' : b.style === 'destructive' ? 'dark' : ordered.length === 1 || i === ordered.length - 1 ? 'primary' : 'outline'}
              style={[row && styles.flex, b.style === 'destructive' && styles.danger]}
              onPress={() => close(d, b)}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = createStyles(() => ({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  web: { zIndex: 1000 },
  scrim: { backgroundColor: 'rgba(8,10,11,0.55)' },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[5],
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  message: { marginTop: 2 },
  buttons: { alignSelf: 'stretch', gap: space[2], marginTop: space[4] },
  buttonsRow: { flexDirection: 'row' },
  flex: { flex: 1 },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
}));
