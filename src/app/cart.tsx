import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronRight, ShoppingBag, Timer } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { qk, useMyHolds } from '@/features/api/queries';
import type { Hold } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { formatDay, formatRange } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, gutter, radius, space } from '@/theme/tokens';

/** One ticking clock for the whole list. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Cart: slots held for this player (each for up to 10 minutes). Usually empty,
 * because leaving checkout gives the slot back; a hold stays here only if the app
 * closed mid-checkout or the release couldn't reach the server.
 */
export default function Cart() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const holds = useMyHolds();
  const pull = usePullToRefresh(holds.refetch);
  const now = useNow();
  const live = (holds.data ?? []).filter((h) => h.expiresAt > now);

  const open = (h: Hold) => {
    qc.setQueryData(qk.hold(h.holdId), h);
    router.push({ pathname: '/checkout', params: { holdId: h.holdId } });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Cart" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}>
        {holds.isPending ? (
          <Skeleton height={112} r={radius.lg} />
        ) : live.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Your cart is empty"
            body="Pick a slot on any turf. It’s held for you for 10 minutes while you pay."
            action="Find a turf"
            onAction={() => router.dismissTo('/explore')}
          />
        ) : (
          live.map((h) => {
            const left = Math.max(0, h.expiresAt - now);
            const label = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
            return (
              <PressableScale
                key={h.holdId}
                scaleTo={0.985}
                onPress={() => open(h)}
                accessibilityRole="button"
                accessibilityLabel={`${h.venue.name}, continue to checkout`}>
                <Card style={styles.item}>
                  <Photo source={h.venue.photo} style={styles.photo} rounded={radius.md} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {h.venue.name}
                    </Text>
                    <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                      {formatDay(h.day, { year: false })} · {formatRange(h.start, h.end)}
                    </Text>
                    <View style={styles.meta}>
                      <Text variant="labelStrong">{formatTaka(h.total)}</Text>
                      <View style={styles.timer}>
                        <Timer size={13} color={colors.limeText} strokeWidth={2.4} />
                        <Text variant="caption" color={colors.limeText}>
                          Held · {label}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <ChevronRight size={20} color={colors.ink} />
                </Card>
              </PressableScale>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[3] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  photo: { width: 76, height: 76 },
  flex: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.limeSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
