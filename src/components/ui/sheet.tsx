import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, radius } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const OPEN = { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) }; // smooth "ease-out-quint"
const CLOSE = { duration: 220, easing: Easing.bezier(0.4, 0, 1, 1) };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Runs after the close animation finishes — use it to navigate after a menu closes. */
  onClosed?: () => void;
  side?: 'bottom' | 'left';
  /** Width of a left drawer. */
  width?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Animated sheet / drawer.
 * Why it no longer jumps: the panel is measured first and stays invisible until
 * its real size is known, then slides in from exactly off-screen on the UI thread.
 * Drag it down (or left, for the drawer) to dismiss; tap the dimmed area to close.
 */
export function Sheet({ visible, onClose, onClosed, side = 'bottom', width = 320, style, children }: Props) {
  const { height: screenH } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setMounted(true);
  }

  const progress = useSharedValue(0); // 0 = hidden, 1 = open
  const drag = useSharedValue(0); // px dragged towards closing
  const extent = useSharedValue(0); // measured panel height (bottom) or width (left)
  const lift = useSharedValue(0); // px the keyboard overlaps the bottom of the sheet
  const rootH = useRef(0);
  const measured = useRef(false);
  const closedCb = useRef(onClosed);
  useEffect(() => {
    closedCb.current = onClosed;
  }, [onClosed]);

  const finishClose = () => {
    measured.current = false;
    extent.set(0);
    setMounted(false);
    closedCb.current?.();
  };

  const open = () => {
    drag.set(0);
    progress.set(withTiming(1, OPEN));
  };

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      if (measured.current) open();
    } else {
      if (side === 'bottom') Keyboard.dismiss();
      progress.set(
        withTiming(0, CLOSE, (finished) => {
          if (finished) scheduleOnRN(finishClose);
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mounted]);

  const onLayout = (e: LayoutChangeEvent) => {
    const size = side === 'bottom' ? e.nativeEvent.layout.height : e.nativeEvent.layout.width;
    extent.set(size);
    if (!measured.current) {
      measured.current = true;
      if (visible) open();
    }
  };

  // Raise a bottom sheet above the keyboard. Overlap is measured against the
  // modal's own height, so it is correct whether or not Android already
  // resized the window (adjustResize vs edge-to-edge).
  useEffect(() => {
    if (!mounted || side !== 'bottom') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const h = rootH.current || screenH;
      const overlap = Math.max(0, h - e.endCoordinates.screenY);
      lift.set(withTiming(overlap, { duration: ios ? e.duration || 250 : 200, easing: Easing.out(Easing.cubic) }));
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      lift.set(withTiming(0, { duration: ios ? e?.duration || 250 : 200, easing: Easing.out(Easing.cubic) }));
    });
    return () => {
      show.remove();
      hide.remove();
      lift.set(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, side, screenH]);

  const vertical = side === 'bottom';
  // Runs on the JS thread: the gesture worklet can't touch `Keyboard` itself (it's undefined
  // on the UI thread), so it hands this one function over instead.
  const closeFromDrag = () => {
    Keyboard.dismiss();
    onClose();
  };
  const pan = usePanGesture({
    activeOffsetY: vertical ? 10 : undefined,
    failOffsetX: vertical ? [-24, 24] : undefined,
    activeOffsetX: vertical ? undefined : -10,
    failOffsetY: vertical ? undefined : [-24, 24],
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, side === 'bottom' ? e.translationY : -e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      const v = side === 'bottom' ? e.velocityY : -e.velocityX;
      if (drag.get() > extent.get() * 0.3 || v > 900) {
        scheduleOnRN(closeFromDrag);
      }
      else drag.set(withSpring(0, { damping: 24, stiffness: 300 }));
    },
  });

  const panel = useAnimatedStyle(() => {
    const size = extent.get();
    const offset = Math.max(drag.get(), (1 - progress.get()) * size);
    return {
      opacity: size > 0 ? 1 : 0,
      transform: side === 'bottom' ? [{ translateY: offset - lift.get() }] : [{ translateX: -offset }],
    };
  });

  const scrim = useAnimatedStyle(() => {
    const size = extent.get() || 1;
    return { opacity: progress.get() * interpolate(drag.get(), [0, size], [1, 0.2]) };
  });

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(e) => {
          rootH.current = e.nativeEvent.layout.height;
        }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={onLayout}
            style={[side === 'bottom' ? [styles.bottom, { maxHeight: screenH * 0.9 }] : [styles.left, { width }], style, panel]}
            accessibilityViewIsModal>
            {side === 'bottom' ? <View style={styles.grabber} /> : null}
            {children}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1 },
  scrim: { backgroundColor: colors.scrim },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  left: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginTop: 10,
    marginBottom: 6,
  },
}));
