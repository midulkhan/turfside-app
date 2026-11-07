import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router, useScrollToTop } from 'expo-router';
import { useRef } from 'react';
import { Heart } from 'lucide-react-native';
import { RefreshControl, View } from 'react-native';

import { useTabBarSpace } from '@/components/navigation/tab-bar';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { VenueCard } from '@/components/venue/venue-card';
import { VenueCardSkeleton } from '@/components/venue/venue-card-skeleton';
import { useSaved } from '@/features/api/queries';
import type { VenueSummary } from '@/features/api/types';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

// FlashList v2 keeps an anchor item in view by default, which makes the page jump when data changes.
const NO_ANCHOR = { disabled: true };

export default function Saved() {
  const listRef = useRef<FlashListRef<VenueSummary>>(null);
  useScrollToTop(listRef as never); // tap the active tab again → back to top
  const scrolled = useScrolled();
  const bottom = useTabBarSpace();
  const { data, isPending, isError, error, refetch } = useSaved();
  const pull = usePullToRefresh(refetch);
  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <View style={styles.sticky}>
          <Text variant="pageTitle">Saved turfs</Text>
        </View>
      </StickyHeader>
      <FlashList
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={NO_ANCHOR}
        ref={listRef}
        data={data ?? []}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <VenueCard venue={{ ...item, isSaved: true }} />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="body" color={colors.textMuted}>
              Your favourite pitches, one tap away.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
        ListEmptyComponent={
          isPending ? (
            <View style={styles.item}>
              <VenueCardSkeleton />
            </View>
          ) : isError ? (
            <ErrorState message={error.message} onRetry={refetch} />
          ) : (
            <EmptyState
              icon={Heart}
              title="No saved turfs yet"
              body="Tap the heart on any turf to keep it here."
              action="Explore turfs"
              onAction={() => router.navigate('/explore')}
            />
          )
        }
      />
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  sticky: { paddingHorizontal: gutter, paddingTop: space[4], paddingBottom: space[3] },
  header: { paddingHorizontal: gutter, gap: space[1], paddingTop: space[2], paddingBottom: space[5] },
  item: { paddingHorizontal: gutter, paddingBottom: space[4] },
}));
