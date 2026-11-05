import { BellRing, CreditCard, Megaphone } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useNotifications } from '@/features/api/queries';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';

const ICON = { booking: BellRing, payment: CreditCard, promo: Megaphone };

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
            const Icon = ICON[n.kind];
            return (
              <Card key={n.id} style={styles.item}>
                <View style={[styles.icon, !n.read && styles.iconUnread]}>
                  <Icon size={20} color={colors.ink} strokeWidth={1.9} />
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
          })
        ) : (
          <EmptyState icon={BellRing} title="You’re all caught up" />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
