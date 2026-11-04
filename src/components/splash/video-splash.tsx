import { useEventListener } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

const SOURCE = require('@/assets/video/splash.mp4');
const MAX_SPLASH_MS = 6500; // never trap the user if the video fails

/**
 * Animated splash: the native splash is plain white, then this white overlay
 * plays the logo reveal and fades out once the video ends AND the app is ready.
 * The video (1024×576, 140 KB, white background) is bundled, so it never waits on the network.
 */
export function VideoSplash({ appReady, onDone }: { appReady: boolean; onDone: () => void }) {
  const [ended, setEnded] = useState(false);
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

  useEffect(() => {
    if (ended && appReady) onDone();
  }, [ended, appReady, onDone]);

  return (
    <Animated.View exiting={FadeOut.duration(320)} style={styles.root} pointerEvents="auto">
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          surfaceType="textureView"
          allowsPictureInPicture={false}
          onFirstFrameRender={hideNative}
        />
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
});
