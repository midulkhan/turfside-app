import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { createStyles } from '@/theme/styles';

const SOURCE = require('@/assets/video/splash.mp4');
const LAST_FRAME = require('@/assets/video/splash-end.webp'); // the video's final frame, as a still
const MAX_SPLASH_MS = 6500; // never trap the user if the video fails

/**
 * Animated splash: the native splash is plain white, then this white overlay
 * plays the logo reveal and fades out once the video ends AND the app is ready.
 * The video (1024×576, 140 KB, white background) is bundled, so it never waits on the network.
 *
 * Hand-over: a video surface can't fade on Android, and when it's torn down
 * mid-fade it paints black. So before fading we cover the video with a still
 * of its last frame, then remove the video, and only then fade the overlay.
 */
export function VideoSplash({ appReady, onDone }: { appReady: boolean; onDone: () => void }) {
  const [ended, setEnded] = useState(false);
  const [videoGone, setVideoGone] = useState(false);
  const hidNative = useRef(false);

  const player = useVideoPlayer(SOURCE, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });

  const hideNative = () => {
    if (hidNative.current) return;
    hidNative.current = true;
    SplashScreen.hideAsync().catch(() => {});
  };

  useEventListener(player, 'playToEnd', () => setEnded(true));
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') {
      hideNative();
      setEnded(true);
    }
  });

  useEffect(() => {
    const t = setTimeout(() => {
      hideNative();
      setEnded(true);
    }, MAX_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // finishing: the still covers the video → (60ms) video removed → fade out → unmounted.
  // The fade is a plain opacity animation and the unmount a timer, not an `exiting` layout
  // animation: on some Android builds those never complete and the white layer stayed on top.
  const finishing = ended && appReady;
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!finishing) return;
    if (!videoGone) {
      const t = setTimeout(() => setVideoGone(true), 60);
      return () => clearTimeout(t);
    }
    opacity.set(withTiming(0, { duration: 320 }));
    const t = setTimeout(onDone, 340);
    return () => clearTimeout(t);
  }, [finishing, videoGone, onDone, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={[styles.root, fade]} pointerEvents={finishing && videoGone ? 'none' : 'auto'}>
      <View style={styles.videoWrap}>
        {!videoGone ? (
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
            allowsPictureInPicture={false}
            onFirstFrameRender={hideNative}
          />
        ) : null}
        {finishing ? <Image source={LAST_FRAME} style={styles.still} contentFit="contain" /> : null}
      </View>
    </Animated.View>
  );
}

const styles = createStyles(() => ({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoWrap: { width: '100%', aspectRatio: 16 / 9, maxWidth: 560 },
  video: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  still: { ...StyleSheet.absoluteFill, backgroundColor: '#FFFFFF' },
}));
