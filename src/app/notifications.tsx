import { FlashList } from '@shopify/flash-list';
import { BellRing, CreditCard, Megaphone, UsersRound } from 'lucide-react-native';
import { useMemo } from 'react';
import { RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { END_THRESHOLD, ListLoader } from '@/components/ui/list-loader';
import { PressableScale } from '@/components/ui/pressable-scale';
import { ScreenHeader } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useNotificationPages } from '@/features/api/queries';
import type { NotificationItem } from '@/features/api/types';
import { notificationTarget } from '@/features/notifications/open';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const ICON = { booking: BellRing, payment: CreditCard, promo: Megaphone, match: UsersRound };

const target = (n: NotificationItem) => notificationTarget(n.data);

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

export default function Notifications() {
  const insets = useSafeAreaInsets();
  // 10 at a time; the next 10 load as you near the bottom.
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationPages();
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);
  const pull = usePullToRefresh(refetch);
  const scrolled = useScrolled();
  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Notifications" />
      </StickyHeader>
      <FlashList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <NotificationRow n={item} />}
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={END_THRESHOLD}
        ListFooterComponent={items.length ? <ListLoader loading={isFetchingNextPage} /> : null}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        contentContainerStyle={{ ...styles.list, paddingBottom: insets.bottom + space[6] }}
        ListEmptyComponent={
          isPending ? (
            <View style={styles.skeletons}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={84} r={radius.lg} />
              ))}
            </View>
          ) : isError ? (
            <ErrorState message="Couldn’t load notifications. Check your connection." onRetry={refetch} />
          ) : (
            <EmptyState icon={BellRing} title="You’re all caught up" />
          )
        }
      />
    </View>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
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
  return (
    <View style={styles.row}>
      {go ? (
        <PressableScale onPress={go} scaleTo={0.985} accessibilityRole="button">
          {card}
        </PressableScale>
      ) : (
        card
      )}
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  // FlashList has no `gap`: each row carries its own spacing.
  list: { paddingHorizontal: gutter, paddingTop: space[2] },
  row: { paddingBottom: space[3] },
  skeletons: { gap: space[3] },
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
