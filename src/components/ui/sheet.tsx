import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
  type ViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /**
   * Bottom sheets scroll their content when it's taller than the space left (small phones,
   * keyboard up). Pass false when the content scrolls itself (e.g. a long option list).
   */
  scroll?: boolean;
  children: ReactNode;
};

/**
 * Animated sheet / drawer.
 * Why it no longer jumps: the panel is measured first and stays invisible until
 * its real size is known, then slides in from exactly off-screen on the UI thread.
 * Drag it down (or left, for the drawer) to dismiss; tap the dimmed area to close.
 */
export function Sheet({ visible, onClose, onClosed, side = 'bottom', width = 320, style, scroll = true, children }: Props) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [kb, setKb] = useState(0); // keyboard overlap, for sizing (the lift below animates it)
  const [overflow, setOverflow] = useState(false); // content taller than the sheet: it scrolls
  const scroller = useRef<ScrollViewInstance>(null);
  const content = useRef<ViewInstance>(null);
  const [rootSize, setRootSize] = useState(0); // modal height, for sizing in render
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const contentH = useRef(0);
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

  /** Scroll so the focused text field (and a little below it) sits above the keyboard. */
  function revealFocused() {
    const field = TextInput.State.currentlyFocusedInput();
    const box = content.current;
    if (!field || !box || !scroller.current) return;
    field.measureLayout(
      box,
      (_x, y, _w, h) => {
        const view = viewportH.current;
        const top = scrollY.current;
        const room = 96; // keep the next control (often the button) in sight too
        if (y + h + room > top + view) scroller.current?.scrollTo({ y: Math.min(y + h + room - view, Math.max(0, contentH.current - view)), animated: true });
        else if (y < top) scroller.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      },
      () => {},
    );
  }

  // Raise a bottom sheet above the keyboard. Overlap is measured against the
  // modal's own height, so it is correct whether or not Android already
  // resized the window (adjustResize vs edge-to-edge).
  useEffect(() => {
    if (!mounted || side !== 'bottom') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const h = rootH.current || screenH;
      const overlap = Math.max(0, h - e.endCoordinates.screenY);
      const duration = ios ? e.duration || 250 : 200;
      lift.set(withTiming(overlap, { duration, easing: Easing.out(Easing.cubic) }));
      setKb(overlap);
      // Once the sheet has resized above the keyboard, bring the field being typed in into view.
      setTimeout(revealFocused, duration + 60);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      lift.set(withTiming(0, { duration: ios ? e?.duration || 250 : 200, easing: Easing.out(Easing.cubic) }));
      setKb(0);
    });
    return () => {
      show.remove();
      hide.remove();
      lift.set(0);
      setKb(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, side, screenH]);

  const checkOverflow = () => setOverflow(contentH.current > viewportH.current + 1);

  const vertical = side === 'bottom';
  const scrolls = vertical && scroll;
  // Runs on the JS thread: the gesture worklet can't touch `Keyboard` itself (it's undefined
  // on the UI thread), so it hands this one function over instead.
  const closeFromDrag = () => {
    Keyboard.dismiss();
    onClose();
  };
  // Drag anywhere to close — unless the content scrolls; then only by the handle, so a
  // scroll never closes the sheet or lands as a tap on a checkbox.
  const pan = usePanGesture({
    enabled: !(scrolls && overflow),
    activeOffsetY: vertical ? 10 : undefined,
    failOffsetX: vertical ? ([-24, 24] as [number, number]) : undefined,
    activeOffsetX: vertical ? undefined : -10,
    failOffsetY: vertical ? undefined : ([-24, 24] as [number, number]),
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, side === 'bottom' ? e.translationY : -e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      const v = side === 'bottom' ? e.velocityY : -e.velocityX;
      if (drag.get() > extent.get() * 0.3 || v > 900) scheduleOnRN(closeFromDrag);
      else drag.set(withSpring(0, { damping: 24, stiffness: 300 }));
    },
  });
  // The handle of a scrolling sheet (bottom only).
  const handlePan = usePanGesture({
    activeOffsetY: 10,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      drag.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (drag.get() > extent.get() * 0.3 || e.velocityY > 900) scheduleOnRN(closeFromDrag);
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
          setRootSize(e.nativeEvent.layout.height);
        }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        {scrolls ? (
          <Animated.View
            onLayout={onLayout}
            // Fits between the status bar and the keyboard, so nothing ends up off-screen.
            style={[styles.bottom, { maxHeight: Math.min(screenH * 0.9, (rootSize || screenH) - kb - insets.top - 8) }, style, panel]}
            accessibilityViewIsModal>
            <GestureDetector gesture={handlePan}>
              <View style={styles.handle} accessibilityLabel="Drag down to close">
                <View style={styles.grabberBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={pan}>
              <ScrollView
                ref={scroller}
                style={styles.scroll}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                showsVerticalScrollIndicator={overflow}
                scrollEventThrottle={32}
                onScroll={(e) => {
                  scrollY.current = e.nativeEvent.contentOffset.y;
                }}
                onLayout={(e) => {
                  viewportH.current = e.nativeEvent.layout.height;
                  checkOverflow();
                }}
                onContentSizeChange={(_w, h) => {
                  contentH.current = h;
                  checkOverflow();
                }}>
                <View ref={content} style={{ paddingBottom: kb > 0 ? 0 : insets.bottom }}>
                  {children}
                </View>
              </ScrollView>
            </GestureDetector>
          </Animated.View>
        ) : (
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={onLayout}
              style={[side === 'bottom' ? [styles.bottom, { maxHeight: screenH * 0.9 }] : [styles.left, { width }], style, panel]}
              accessibilityViewIsModal>
              {side === 'bottom' ? <View style={styles.grabber} /> : null}
              {children}
            </Animated.View>
          </GestureDetector>
        )}
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
  scroll: { flexGrow: 0, flexShrink: 1 },
  // A taller, easy-to-grab strip at the top of a scrolling sheet.
  handle: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  grabberBar: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
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
