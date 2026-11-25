import { useLocalSearchParams } from 'expo-router';
import { CalendarDays, CircleCheck, Info, MapPin, Pause, Pencil, Phone, Play, Share2, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { SquadBar, Tag, VersusCard, VsTag, isOpponent, matchTitle, levelLabel, positionLabel, shareMatchContent, versusLabel, whenLabel } from '@/components/match/match-ui';
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
import { formatPhone } from '@/components/match/contact-row';
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

function StatusPill({ status, opponent }: { status: MatchManage['status']; opponent?: boolean }) {
  const open = status === 'open';
  const label = opponent
    ? open
      ? 'Looking for an opponent'
      : status === 'paused'
        ? 'Challenges paused'
        : status === 'full'
          ? 'Opponent confirmed'
          : 'Closed'
    : open
      ? 'Recruitment open'
      : status === 'paused'
        ? 'Recruitment paused'
        : status === 'full'
          ? 'Squad full'
          : 'Closed';
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
  const opp = isOpponent(m);
  // The team that's paid (or paying now) to play you.
  const opponentTeam = opp ? m.squad[0] : undefined;

  const share = () => Share.share(shareMatchContent(m, true));

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
      <StatusPill status={m.status} opponent={opp} />
      <View style={styles.headline}>
        <Text variant="h1">{opp ? 'Your team. Your pick.' : 'Your match. Your squad.'}</Text>
        <Text variant="body" color={colors.textMuted}>
          {opp ? 'Choose the team you play in your upcoming game.' : 'Manage players for your upcoming game.'}
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
            {matchTitle(m)}
          </Text>
          <Pencil size={18} color={colors.ink} strokeWidth={1.8} />
        </Pressable>
        {opp ? (
          <VersusCard
            bare
            left={{ name: m.teamName ?? 'Your team', caption: 'Your team', avatar: m.faces[0] }}
            right={
              opponentTeam
                ? { name: opponentTeam.teamName ?? opponentTeam.name, caption: `Captain ${opponentTeam.name}`, avatar: opponentTeam }
                : { name: 'Opponent?', caption: m.requests.length ? `${m.requests.length} challenge${m.requests.length === 1 ? '' : 's'} waiting` : 'Waiting for challenges', muted: true }
            }
          />
        ) : (
          <>
            <View style={styles.stats}>
              <Stat value={`${m.playersIn} / ${m.playersTotal}`} label="Players" />
              <View style={styles.vr} />
              <Stat value={String(m.openSpots)} label="Open spots" />
              <View style={styles.vr} />
              <Stat value={formatTaka(m.share)} label="Per player" />
            </View>
            <SquadBar total={m.playersTotal} inCount={m.playersIn} reserved={reserved} />
          </>
        )}
        <View style={[styles.tags, opp && styles.tagsCentered]}>
          {opp ? <VsTag /> : null}
          <Tag label={levelLabel(m.level)} />
          <Tag label={opp ? versusLabel(m.format) : m.format} />
        </View>
        <View style={styles.buttons}>
          <Button label="Share invite" variant="outline" icon={Share2} small onPress={share} style={styles.flex} />
          {canPause ? (
            <Button
              label={m.status === 'paused' ? 'Resume' : 'Pause'}
              accessibilityHint={
                opp
                  ? m.status === 'paused'
                    ? 'Lets teams challenge you again'
                    : 'Stops new challenges for now'
                  : m.status === 'paused'
                    ? 'Lets players ask to join again'
                    : 'Stops new join requests for now'
              }
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
        {opp ? 'Challenges' : 'Awaiting your approval'}
      </Text>
      {m.requests.length ? (
        m.requests.map((p) => (
          <Card key={p.userId} style={styles.request}>
            <View style={styles.person}>
              <Avatar name={p.name} uri={p.avatar} size={52} />
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                    {p.teamName ?? p.name}
                  </Text>
                  {p.teamName ? null : <SpotsTag n={p.spots} />}
                </View>
                <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                  {p.teamName
                    ? `Captain ${p.name} · ${levelLabel(p.level)}`
                    : `${positionLabel(p.position)} · ${levelLabel(p.level)}`}
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
            {opp ? 'No challenges yet. Share your post so teams nearby see it.' : 'No requests yet. Share the invite to fill your spots faster.'}
          </Text>
        </Card>
      )}
      <View style={styles.note}>
        <Info size={16} color={colors.textMuted} strokeWidth={1.8} />
        <Text variant="label" color={colors.textMuted} style={styles.flex}>
          {opp
            ? 'The team you accept is confirmed straight away. They pay their share to you at the turf.'
            : 'Players you accept are confirmed straight away. They pay their share to you at the turf.'}
        </Text>
      </View>

      {/* Squad */}
      {m.squad.length ? (
        <>
          <Text variant="h2" style={styles.section}>
            {opp ? 'Your opponent' : 'In your squad'}
          </Text>
          {m.squad.map((p) => (
            <Card key={p.userId} style={styles.member}>
              {/* Name and details get the full width; spots on the right, payment state below. */}
              <View style={styles.person}>
                <Avatar name={p.name} uri={p.avatar} size={44} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {p.teamName ?? p.name}
                  </Text>
                  <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                    {p.teamName
                      ? `Captain ${p.name}`
                      : `${positionLabel(p.position)} · ${levelLabel(p.level)}`}
                  </Text>
                </View>
                {p.teamName ? null : <SpotsTag n={p.spots} always />}
              </View>
              <View style={styles.memberFoot}>
                <View style={[styles.state, p.paid ? styles.statePaid : styles.stateWaiting]}>
                  <Text variant="caption" color={p.paid ? colors.limeText : colors.warningText}>
                    {p.paid ? `Confirmed · pays ${formatTaka(m.share * (p.teamName ? 1 : (p.spots ?? 1)))} at the turf` : 'Confirming…'}
                  </Text>
                </View>
                {/* Their number appears once you accept them (they agreed when asking). Only you see it. */}
                {p.phone ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${p.name}`}
                    hitSlop={8}
                    onPress={() => Linking.openURL(`tel:${p.phone}`)}
                    style={({ pressed }) => [styles.call, pressed && styles.callPressed]}>
                    <Phone size={14} color={colors.ink} strokeWidth={2} />
                    <Text variant="label" numberOfLines={1}>
                      {formatPhone(p.phone)}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function Stat({ value, label, text }: { value: string; label: string; text?: boolean }) {
  return (
    <View style={styles.stat}>
      {/* `text`: a name rather than a number (opponent posts); one line, never pushing others out. */}
      <Text variant={text ? 'title' : 'number'} numberOfLines={1}>
        {value}
      </Text>
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
  stat: { flex: 1, alignItems: 'center', gap: 2, minWidth: 0 },
  vr: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  // Under the VS card the pills sit in the middle, lined up with the badge.
  tagsCentered: { justifyContent: 'center' },
  buttons: { flexDirection: 'row', gap: space[3] },
  section: { marginTop: space[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  member: { gap: space[3] },
  // Lines up with the name (avatar 44 + gap).
  memberFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginLeft: 44 + space[3] },
  call: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
  },
  callPressed: { backgroundColor: colors.surfaceMuted },
  request: { gap: space[3] },
  decide: { flexDirection: 'row', gap: space[3] },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  state: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  statePaid: { backgroundColor: colors.limeSoft },
  stateWaiting: { backgroundColor: colors.warningSoft },
  sheet: { padding: space[5], gap: space[4] },
}));
