import { router } from 'expo-router';
import { BellRing, CreditCard, Megaphone, UsersRound } from 'lucide-react-native';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { ScreenHeader } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useNotifications } from '@/features/api/queries';
import type { NotificationItem } from '@/features/api/types';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const ICON = { booking: BellRing, payment: CreditCard, promo: Megaphone, match: UsersRound };

/** Where a notification leads: accepted → pay your share; a request → manage; other match news → find players. */
function target(n: NotificationItem): (() => void) | null {
  const id = n.data?.matchId;
  if (!id) return null;
  switch (n.data?.type) {
    case 'match_accepted':
      return () => router.push({ pathname: '/checkout', params: { match: id } });
    case 'match_request':
    case 'match_member_paid':
      return () => router.push({ pathname: '/match/[id]', params: { id } });
    default:
      return () => router.push('/players');
  }
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const { data, isPending, isError, refetch } = useNotifications();
  const pull = usePullToRefresh(refetch);
  const scrolled = useScrolled();
  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Notifications" />
      </StickyHeader>
      <ScrollView
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space[6] }]}>
        {isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={84} r={radius.lg} />)
        ) : isError && !data ? (
          <ErrorState message="Couldn’t load notifications. Check your connection." onRetry={refetch} />
        ) : data?.length ? (
          data.map((n) => {
            const Icon = ICON[n.kind] ?? BellRing;
            const go = target(n);
            const card = (
              <Card style={styles.item}>
                <View style={[styles.icon, !n.read && styles.iconUnread]}>
                  <Icon size={20} color={n.read ? colors.ink : colors.charcoal} strokeWidth={1.9} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.top}>
                    <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text variant="caption" color={colors.textSubtle}>
                      {ago(n.at)}
                    </Text>
                  </View>
                  <Text variant="label" color={colors.textMuted}>
                    {n.body}
                  </Text>
                </View>
              </Card>
            );
            return go ? (
              <PressableScale key={n.id} onPress={go} scaleTo={0.985} accessibilityRole="button">
                {card}
              </PressableScale>
            ) : (
              <View key={n.id}>{card}</View>
            );
          })
        ) : (
          <EmptyState icon={BellRing} title="You’re all caught up" />
        )}
      </ScrollView>
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: gutter, gap: space[3], paddingTop: space[2] },
  item: { flexDirection: 'row', gap: space[3] },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUnread: { backgroundColor: colors.lime },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: 2 },
}));
