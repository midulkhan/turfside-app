import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/navigation/tab-bar';
import { themedScreen, useTheme } from '@/theme/theme-provider';
import { colors } from '@/theme/tokens';

export const unstable_settings = { anchor: 'explore' };

export default function TabsLayout() {
  const { scheme } = useTheme(); // re-render (and re-theme every tab) on a theme switch
  return (
    <Tabs
      backBehavior="initialRoute" // back from any tab goes to Explore (the anchor)
      screenLayout={themedScreen(scheme)}
      tabBar={(props) => <TabBar key={scheme} {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'fade', // short cross-fade between tabs
        freezeOnBlur: true, // hidden tabs stop re-rendering
        lazy: true, // a tab mounts the first time it is opened
      }}>
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
