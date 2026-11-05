import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

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

  // finishing: the still covers the video → (60ms) video removed → (60ms) fade out.
  const finishing = ended && appReady;
  useEffect(() => {
    if (!finishing) return;
    const t = setTimeout(() => (videoGone ? onDone() : setVideoGone(true)), 60);
    return () => clearTimeout(t);
  }, [finishing, videoGone, onDone]);

  return (
    <Animated.View exiting={FadeOut.duration(320)} style={styles.root} pointerEvents="auto">
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

const styles = StyleSheet.create({
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
});
