import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/navigation/tab-bar';
import { colors } from '@/theme/tokens';

export const unstable_settings = { anchor: 'explore' };

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'fade', // short cross-fade between tabs
        freezeOnBlur: true, // hidden tabs stop re-rendering
        lazy: true, // a tab mounts the first time it is opened
      }}>
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart' }} />
      <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
