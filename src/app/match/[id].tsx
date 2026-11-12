import { useLocalSearchParams } from 'expo-router';
import { CalendarDays, CircleCheck, Info, MapPin, Pause, Pencil, Play, Share2, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { SquadBar, Tag, clockLabel, levelLabel, positionLabel, whenLabel } from '@/components/match/match-ui';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { Input } from '@/components/ui/input';
import { Photo } from '@/components/ui/photo';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useDecideRequest, useMatchManage, useUpdateMatch } from '@/features/api/queries';
import { useLiveMatch, useRefreshAt } from '@/features/api/realtime';
import type { MatchManage, MatchPerson } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { formatTaka } from '@/lib/money';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, font, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/** Organiser: who asked, who's in, and the controls for an open match. */
export default function ManageMatch() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  const q = useMatchManage(id);
  useLiveMatch(id); // requests, payments and released spots appear as they happen
  useRefreshAt(q.data?.reservedUntil, q.refetch);
  const pull = usePullToRefresh(q.refetch);
  const update = useUpdateMatch(id);
  const [editing, setEditing] = useState(false);
  const m = q.data;

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Manage match" />
      </StickyHeader>

      {q.isError && !m ? (
        <ErrorState message={q.error.message} onRetry={q.refetch} />
      ) : (
        <ScrollView
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}
          showsVerticalScrollIndicator={false}>
          {m ? <Body m={m} onEditTitle={() => setEditing(true)} pausing={update.isPending} onPause={(p) => update.mutate({ paused: p })} /> : <Loading />}
        </ScrollView>
      )}
      <TitleSheet
        visible={editing}
        initial={m?.title ?? ''}
        saving={update.isPending}
        onClose={() => setEditing(false)}
        onSave={(title) => update.mutate({ title }, { onSuccess: () => setEditing(false), onError: (e) => Alert.alert('Could not rename', e.message) })}
      />
    </View>
  );
}

/** "2 spots" when one request covers the player and friends (always shown in the squad). */
function SpotsTag({ n = 1, always }: { n?: number; always?: boolean }) {
  if (n <= 1 && !always) return null;
  return (
    <View style={styles.spotsTag}>
      <Text variant="caption" color={colors.limeText} style={styles.spotsTagText}>
        {n === 1 ? '1 spot' : `${n} spots`}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { status: MatchManage['status'] }) {
  const open = status === 'open';
  const label = open ? 'Recruitment open' : status === 'paused' ? 'Recruitment paused' : status === 'full' ? 'Squad full' : 'Closed';
  return (
    <View style={[styles.pill, !open && styles.pillMuted]}>
      <View style={[styles.dot, !open && styles.dotMuted]} />
      <Text variant="labelStrong" color={open ? colors.limeText : colors.textMuted}>
        {label}
      </Text>
    </View>
  );
}

function Body({ m, onEditTitle, onPause, pausing }: { m: MatchManage; onEditTitle: () => void; onPause: (paused: boolean) => void; pausing: boolean }) {
  const decide = useDecideRequest(m.id);
  const reserved = m.squad.filter((s) => !s.paid).length;
  const canPause = m.status === 'open' || m.status === 'paused';

  const share = () =>
    Share.share({
      message: `Join my game: ${m.title} at ${m.venue.name}, ${whenLabel(m)}. ${m.spotsLeft} spot${m.spotsLeft === 1 ? '' : 's'} left, ${formatTaka(m.share)} per player. Open TurfSides → Find players.`,
    });

  const answer = (p: MatchPerson, accept: boolean) => {
    haptic.select();
    decide.mutate(
      { userId: p.userId, accept },
      {
        onSuccess: () => (accept ? haptic.success() : undefined),
        onError: (e) => {
          haptic.error();
          Alert.alert(accept ? 'Could not accept' : 'Could not decline', e.message);
        },
      },
    );
  };

  return (
    <>
      <StatusPill status={m.status} />
      <View style={styles.headline}>
        <Text variant="h1">Your match. Your squad.</Text>
        <Text variant="body" color={colors.textMuted}>
          Manage players for your upcoming game.
        </Text>
      </View>

      {/* The booking it runs on */}
      <Card style={styles.bookingCard}>
        <Photo source={m.venue.photo} style={styles.bookingPhoto} />
        <View style={styles.flex}>
          <Text variant="title" numberOfLines={1}>
            {m.venue.name}
          </Text>
          <View style={styles.line}>
            <CircleCheck size={16} color={colors.limeText} strokeWidth={2} />
            <Text variant="labelStrong" color={colors.limeText}>
              Booking confirmed
            </Text>
          </View>
          <View style={styles.line}>
            <CalendarDays size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1}>
              {whenLabel(m)}
            </Text>
          </View>
          <View style={styles.line}>
            <MapPin size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1}>
              {m.venue.area}
            </Text>
          </View>
        </View>
      </Card>

      {/* The match */}
      <Card style={styles.matchCard}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${m.title}`} onPress={onEditTitle} style={styles.titleRow} hitSlop={6}>
          <Text variant="h2" numberOfLines={1} style={styles.titleText}>
            {m.title}
          </Text>
          <Pencil size={18} color={colors.ink} strokeWidth={1.8} />
        </Pressable>
        <View style={styles.stats}>
          <Stat value={`${m.playersIn} / ${m.playersTotal}`} label="Players" />
          <View style={styles.vr} />
          <Stat value={String(m.openSpots)} label="Open spots" />
          <View style={styles.vr} />
          <Stat value={formatTaka(m.share)} label="Per player" />
        </View>
        <SquadBar total={m.playersTotal} inCount={m.playersIn} reserved={reserved} />
        <View style={styles.tags}>
          <Tag label={levelLabel(m.level)} />
          <Tag label={m.format} />
        </View>
        <View style={styles.buttons}>
          <Button label="Share invite" variant="outline" icon={Share2} small onPress={share} style={styles.flex} />
          {canPause ? (
            <Button
              label={m.status === 'paused' ? 'Resume' : 'Pause'}
              accessibilityHint={m.status === 'paused' ? 'Lets players ask to join again' : 'Stops new join requests for now'}
              variant="outline"
              icon={m.status === 'paused' ? Play : Pause}
              small
              loading={pausing}
              onPress={() => onPause(m.status !== 'paused')}
              style={styles.flex}
            />
          ) : null}
        </View>
      </Card>

      {/* Requests */}
      <Text variant="h2" style={styles.section}>
        Awaiting your approval
      </Text>
      {m.requests.length ? (
        m.requests.map((p) => (
          <Card key={p.userId} style={styles.request}>
            <View style={styles.person}>
              <Avatar name={p.name} uri={p.avatar} size={52} />
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                    {p.name}
                  </Text>
                  <SpotsTag n={p.spots} />
                </View>
                <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                  {positionLabel(p.position)} · {levelLabel(p.level)}
                </Text>
                <Text variant="caption" color={colors.textMuted}>
                  {p.games === 0 ? 'New player' : p.games === 1 ? '1 game played' : `${p.games} games played`}
                </Text>
              </View>
            </View>
            <View style={styles.decide}>
              <Button label="Decline" variant="outline" small onPress={() => answer(p, false)} disabled={decide.isPending} style={styles.flex} />
              <Button label="Accept" small onPress={() => answer(p, true)} disabled={decide.isPending || m.spotsLeft < (p.spots ?? 1)} style={styles.flex} />
            </View>
          </Card>
        ))
      ) : (
        <Card style={styles.emptyCard}>
          <UsersRound size={20} color={colors.textMuted} strokeWidth={1.8} />
          <Text variant="label" color={colors.textMuted} style={styles.flex}>
            No requests yet. Share the invite to fill your spots faster.
          </Text>
        </Card>
      )}
      <View style={styles.note}>
        <Info size={16} color={colors.textMuted} strokeWidth={1.8} />
        <Text variant="label" color={colors.textMuted} style={styles.flex}>
          Accepted players have 5 minutes to pay. If they don&apos;t, the spots open up again.
        </Text>
      </View>

      {/* Squad */}
      {m.squad.length ? (
        <>
          <Text variant="h2" style={styles.section}>
            In your squad
          </Text>
          {m.squad.map((p) => (
            <Card key={p.userId} style={styles.person}>
              <Avatar name={p.name} uri={p.avatar} size={44} />
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                    {p.name}
                  </Text>
                  <SpotsTag n={p.spots} always />
                </View>
                <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                  {positionLabel(p.position)} · {levelLabel(p.level)}
                </Text>
              </View>
              <View style={[styles.state, p.paid ? styles.statePaid : styles.stateWaiting]}>
                <Text variant="caption" color={p.paid ? colors.limeText : colors.warningText}>
                  {p.paid ? 'Paid' : p.payBy ? `Paying · until ${clockLabel(p.payBy)}` : 'Paying now'}
                </Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="number">{value}</Text>
      <Text variant="label" color={colors.textMuted}>
        {label}
      </Text>
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.loading}>
      <Skeleton width={160} height={30} r={radius.pill} />
      <Skeleton height={70} />
      <Skeleton height={120} r={radius.lg} />
      <Skeleton height={220} r={radius.lg} />
    </View>
  );
}

function TitleSheet({ visible, initial, saving, onClose, onSave }: { visible: boolean; initial: string; saving: boolean; onClose: () => void; onSave: (t: string) => void }) {
  const [value, setValue] = useState(initial);
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setValue(initial);
  }
  const ok = value.trim().length >= 2;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <Text variant="h2">Match name</Text>
        <Input value={value} onChangeText={setValue} maxLength={60} placeholder="e.g. Friday football crew" autoFocus returnKeyType="done" onSubmitEditing={() => ok && onSave(value.trim())} />
        <Button label="Save" onPress={() => onSave(value.trim())} disabled={!ok} loading={saving} />
      </View>
    </Sheet>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  shrink: { flexShrink: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  spotsTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.limeSoft },
  spotsTagText: { fontFamily: font.semibold },
  content: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[3] },
  loading: { gap: space[4] },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.limeSoft },
  pillMuted: { backgroundColor: colors.surfaceMuted },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.limeText },
  dotMuted: { backgroundColor: colors.textMuted },
  headline: { gap: space[1], marginBottom: space[1] },
  bookingCard: { flexDirection: 'row', gap: space[4], alignItems: 'center' },
  bookingPhoto: { width: 116, height: 96, borderRadius: radius.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  matchCard: { gap: space[4] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  titleText: { flexShrink: 1 },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  tags: { flexDirection: 'row', gap: space[2] },
  buttons: { flexDirection: 'row', gap: space[3] },
  section: { marginTop: space[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  request: { gap: space[3] },
  decide: { flexDirection: 'row', gap: space[3] },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  state: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  statePaid: { backgroundColor: colors.limeSoft },
  stateWaiting: { backgroundColor: colors.warningSoft },
  sheet: { padding: space[5], gap: space[4] },
}));
