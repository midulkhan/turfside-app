import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { EmptyState } from '@/components/ui/states';
import { StickyHeader } from '@/components/ui/sticky-header';
import { Text } from '@/components/ui/text';
import { useAuthGate } from '@/features/session/auth-gate';
import { createStyles } from '@/theme/styles';
import { colors, gutter, space } from '@/theme/tokens';

/**
 * A members-only tab (Bookings, Saved, Profile) seen by a guest: the tab's title and one clear
 * way in. Signing in comes back to this tab, now filled in.
 */
export function GuestTab({ title, icon, heading, body, why }: { title: string; icon: LucideIcon; heading: string; body: string; why: string }) {
  const bottom = useTabBarSpace();
  const { requireAuth } = useAuthGate();
  const still = useSharedValue(0);
  return (
    <View style={styles.root}>
      <StickyHeader progress={still}>
        <View style={styles.sticky}>
          <Text variant="pageTitle">{title}</Text>
        </View>
      </StickyHeader>
      <View style={[styles.body, { paddingBottom: bottom }]}>
        <EmptyState icon={icon} title={heading} body={body} action="Sign in or create an account" onAction={() => requireAuth(why)} />
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  sticky: { paddingHorizontal: gutter, paddingTop: space[4], paddingBottom: space[3] },
  body: { flex: 1, justifyContent: 'center' },
}));
