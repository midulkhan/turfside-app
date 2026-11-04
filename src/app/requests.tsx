import { router } from 'expo-router';
import { CalendarDays, Clock3, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { ScreenHeader } from '@/components/ui/headers';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useRequests } from '@/features/api/queries';
import type { PlayerRequest } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { formatDay, formatRange } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';

const STATUS: Record<PlayerRequest['status'], { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: colors.limeSoft, fg: colors.limeText },
  full: { label: 'Full', bg: colors.surfaceMuted, fg: colors.textMuted },
  pending: { label: 'Waiting for organiser', bg: '#FFF4E5', fg: colors.warning },
  accepted: { label: 'You’re in', bg: colors.limeSoft, fg: colors.limeText },
  declined: { label: 'Declined', bg: colors.dangerSoft, fg: colors.danger },
};

function RequestCard({ r }: { r: PlayerRequest }) {
  const s = STATUS[r.status];
  const pct = r.spotsTotal ? r.spotsFilled / r.spotsTotal : 0;
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text variant="title">{r.venueName}</Text>
          <Text variant="label" color={colors.textMuted}>
            {r.area}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: s.bg }]}>
          <Text variant="caption" color={s.fg}>
            {s.label}
          </Text>
        </View>
      </View>
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <CalendarDays size={16} color={colors.textMuted} />
          <Text variant="label">{formatDay(r.day, { year: false })}</Text>
        </View>
        <View style={styles.metaItem}>
          <Clock3 size={16} color={colors.textMuted} />
          <Text variant="label">{formatRange(r.start, r.end)}</Text>
        </View>
      </View>
      <View style={styles.progressRow}>
        <UsersRound size={16} color={colors.ink} />
        <Text variant="labelStrong" style={styles.flex}>
          {r.spotsFilled}/{r.spotsTotal} players joined
        </Text>
        <Text variant="labelStrong">{formatTaka(r.sharePerPlayer)} each</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </Card>
  );
}

/** "Player calls": calls the player posted ("need 2 players") or asked to join. Preview of a phase-3 feature. */
export default function Requests() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'posted' | 'joined'>('posted');
  const { data, isPending } = useRequests();
  const list = (data ?? []).filter((r) => r.kind === tab);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="My calls" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[6] }]}>
        <View style={styles.tabs}>
          <Chip label="Posted by me" active={tab === 'posted'} tone="dark" onPress={() => setTab('posted')} />
          <Chip label="Joined" active={tab === 'joined'} tone="dark" onPress={() => setTab('joined')} />
        </View>
        {isPending ? (
          <Skeleton height={150} r={radius.lg} />
        ) : list.length ? (
          list.map((r) => <RequestCard key={r.id} r={r} />)
        ) : (
          <EmptyState
            icon={UsersRound}
            title={tab === 'posted' ? 'No open requests' : 'You haven’t joined a game yet'}
            body={
              tab === 'posted'
                ? 'From a booking, post the spots you need and nearby players can join.'
                : 'Requests you ask to join show up here.'
            }
            action="My bookings"
            onAction={() => router.navigate('/bookings')}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, gap: space[3], paddingTop: space[2] },
  tabs: { flexDirection: 'row', gap: space[2], marginBottom: space[1] },
  flex: { flex: 1 },
  card: { gap: space[3] },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  pill: { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 3 },
  meta: { flexDirection: 'row', gap: space[4] },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.lime },
});
