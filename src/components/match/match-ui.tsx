import { router } from 'expo-router';
import { ArrowRight, CalendarDays, Check, CircleCheck, Clock3, Eye, MapPin, Minus, Plus, RotateCcw, Settings2 } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Photo } from '@/components/ui/photo';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useCreateMatch, useJoinMatch, useLeaveMatch } from '@/features/api/queries';
import type { Match, MatchLevel, MatchPosition } from '@/features/api/types';
import { haptic } from '@/lib/haptics';
import { formatTaka } from '@/lib/money';
import { dhakaToday, formatClock, formatDay, formatRange, type DayKey } from '@/lib/time';
import { colors, font, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

export const LEVELS: { key: MatchLevel; label: string }[] = [
  { key: 'casual', label: 'Casual' },
  { key: 'regular', label: 'Regular' },
  { key: 'competitive', label: 'Competitive' },
];
export const POSITIONS: { key: MatchPosition; label: string }[] = [
  { key: 'any', label: 'Any position' },
  { key: 'goalkeeper', label: 'Goalkeeper' },
  { key: 'defender', label: 'Defender' },
  { key: 'midfielder', label: 'Midfielder' },
  { key: 'forward', label: 'Forward' },
];
export const levelLabel = (l: MatchLevel) => LEVELS.find((x) => x.key === l)?.label ?? 'Casual';
export const positionLabel = (p: MatchPosition) => (p === 'any' ? 'Any position' : (POSITIONS.find((x) => x.key === p)?.label ?? ''));

/** "Today", "Tomorrow" or "Fri, 13 Nov". */
export function dayLabel(day: DayKey) {
  const today = dhakaToday();
  if (day === today) return 'Today';
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (day === t.toISOString().slice(0, 10)) return 'Tomorrow';
  return formatDay(day, { year: false });
}
export const whenLabel = (m: Pick<Match, 'day' | 'start' | 'end'>) => `${dayLabel(m.day)}, ${formatRange(m.start, m.end)}`;
export const spotsLabel = (n: number) => (n === 1 ? '1 spot left' : `${n} spots left`);

/** Small grey pill (format, level). */
export function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text variant="caption" style={styles.tagText}>
        {label}
      </Text>
    </View>
  );
}

/** One segment per player: in (lime), reserved for a player paying now (soft), open (track). */
export function SquadBar({ total, inCount, reserved = 0 }: { total: number; inCount: number; reserved?: number }) {
  return (
    <View style={styles.bar} accessibilityLabel={`${inCount} of ${total} players in`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.seg, i < inCount ? styles.segIn : i < inCount + reserved ? styles.segHeld : styles.segOpen]} />
      ))}
    </View>
  );
}

function Faces({ m }: { m: Match }) {
  return (
    <View style={styles.faces}>
      <View style={styles.faceRow}>
        {m.faces.map((f, i) => (
          <View key={`${f.name}:${i}`} style={{ marginLeft: i === 0 ? 0 : -12, zIndex: m.faces.length - i }}>
            <Avatar name={f.name} uri={f.avatar} size={36} ring={colors.surface} />
          </View>
        ))}
      </View>
      {m.moreCount > 0 ? (
        <Text variant="label" color={colors.textMuted}>
          +{m.moreCount} joined
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The viewer's next step on a game: join, withdraw, pay, or where they stand.
 * `compact` is the feed card (sits next to View); the details page gets the full labels.
 */
export function MatchAction({ m, onJoin, compact, fill }: { m: Match; onJoin: (m: Match) => void; compact?: boolean; fill?: boolean }) {
  const leave = useLeaveMatch();
  const full = m.spotsLeft === 0;
  const total = m.share * (m.mySpots ?? 1);

  const withdraw = () =>
    Alert.alert('Withdraw your request?', 'You can ask again later if spots are still open.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => leave.mutate(m.id, { onError: (e) => Alert.alert('Could not withdraw', e.message) }) },
    ]);

  const state = (label: string, inSquad = false) => (
    <View style={[styles.state, inSquad && styles.stateIn, fill && styles.flex]}>
      {inSquad ? <CircleCheck size={18} color={colors.limeText} strokeWidth={2} /> : null}
      <Text variant={inSquad ? 'labelStrong' : 'label'} color={inSquad ? colors.limeText : colors.textMuted} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  const grow = fill ? styles.flex : undefined;

  switch (m.my) {
    case 'owner':
      return <Button label="Manage match" variant="outline" icon={Settings2} style={grow} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })} />;
    case 'pending':
      return <Button label={compact ? 'Withdraw' : 'Request sent · Withdraw'} variant="outline" icon={Clock3} loading={leave.isPending} style={grow} onPress={withdraw} />;
    case 'accepted':
      return (
        <Button
          label={compact ? `Pay ${formatTaka(total)}` : `Pay ${formatTaka(total)} to confirm`}
          trailingIcon={ArrowRight}
          style={grow}
          onPress={() => router.push({ pathname: '/checkout', params: { match: m.id } })}
        />
      );
    case 'paid':
      return state("You're in the squad", true);
    default: {
      if (full) return state('This game is full');
      if (m.status !== 'open') return state('Requests are paused');
      // Declined, or the pay window ran out: they can ask again while spots are open.
      const again = m.my === 'declined' || m.my === 'expired';
      return <Button label={again ? 'Request again' : 'Request to join'} variant="dark" icon={again ? RotateCcw : undefined} style={grow} onPress={() => onJoin(m)} />;
    }
  }
}

/** The card's pill: spots left, or where the viewer stands. */
export function statusPill(m: Match) {
  switch (m.my) {
    case 'paid':
      return "You're in";
    case 'accepted':
      return 'Pay now';
    case 'pending':
      return 'Requested';
    case 'declined':
      return 'Not this time';
  }
  return m.spotsLeft === 0 ? 'Full' : spotsLabel(m.spotsLeft);
}

const openDetails = (id: string) => router.push({ pathname: '/game/[id]', params: { id } });

/** A game in the feed: tap it (or View) for the full details. */
export const MatchCard = memo(function MatchCard({ m }: { m: Match }) {
  const full = m.spotsLeft === 0;
  const pill = statusPill(m);
  const muted = (full && m.my !== 'paid' && m.my !== 'accepted') || m.my === 'declined';

  return (
    <Card style={styles.card} padded={false}>
      <Pressable style={styles.top} onPress={() => openDetails(m.id)} accessibilityRole="button" accessibilityLabel={`View ${m.title}`}>
        <Photo source={m.venue.photo} style={styles.photo} recyclingKey={m.id} />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text variant="title" numberOfLines={1} style={styles.titleText}>
              {m.title}
            </Text>
            <View style={[styles.spots, muted && styles.spotsMuted]}>
              <Text variant="caption" style={styles.spotsText} color={muted ? colors.textMuted : colors.limeText}>
                {pill}
              </Text>
            </View>
          </View>
          <View style={styles.line}>
            <MapPin size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
              {m.venue.name}
            </Text>
          </View>
          <View style={styles.line}>
            <CalendarDays size={15} color={colors.textMuted} strokeWidth={1.7} />
            <Text variant="label" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
              {whenLabel(m)}
            </Text>
          </View>
          <View style={styles.tags}>
            <Tag label={m.format} />
            <Tag label={levelLabel(m.level)} />
          </View>
        </View>
      </Pressable>
      <Divider style={styles.divider} />
      <View style={styles.bottom}>
        <Faces m={m} />
        <Text variant="title">
          {formatTaka(m.share)}
          <Text variant="label" color={colors.textMuted}>
            {' '}
            / player
          </Text>
        </Text>
      </View>
      <View style={styles.action}>
        <Button label="View" variant="outline" icon={Eye} onPress={() => openDetails(m.id)} />
      </View>
    </Card>
  );
});

/** Ask to join: position and level (the organiser sees both). You only pay once accepted. */
/** `spots`: how many places the player asks for (themselves + friends). */
export function JoinSheet({ match, spots = 1, onClose }: { match: Match | null; spots?: number; onClose: () => void }) {
  const [position, setPosition] = useState<MatchPosition>('any');
  const [level, setLevel] = useState<MatchLevel>('casual');
  const join = useJoinMatch();
  const send = () => {
    if (!match) return;
    join.mutate(
      { id: match.id, position, level, spots },
      {
        onSuccess: () => {
          haptic.success();
          onClose();
        },
        onError: (e) => {
          haptic.error();
          Alert.alert('Request not sent', e.message);
        },
      },
    );
  };
  return (
    <Sheet visible={!!match} onClose={onClose}>
      {match ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text variant="h2">{match.my === 'declined' || match.my === 'expired' ? 'Ask again' : `Join ${match.title}`}</Text>
            <Text variant="label" color={colors.textMuted}>
              {match.venue.name} · {whenLabel(match)}
            </Text>
          </View>
          <Text variant="labelStrong">Your position</Text>
          <View style={styles.choices}>
            {POSITIONS.map((p) => (
              <Chip key={p.key} label={p.label} active={position === p.key} tone="dark" onPress={() => setPosition(p.key)} />
            ))}
          </View>
          <Text variant="labelStrong">Your level</Text>
          <View style={styles.choices}>
            {LEVELS.map((l) => (
              <Chip key={l.key} label={l.label} active={level === l.key} tone="dark" onPress={() => setLevel(l.key)} />
            ))}
          </View>
          <View style={styles.note}>
            <Check size={16} color={colors.limeText} strokeWidth={2.4} />
            <Text variant="label" color={colors.textMuted} style={styles.flex}>
              {spots === 1
                ? `You pay ${formatTaka(match.share)} only if the organiser accepts you.`
                : `You pay ${formatTaka(match.share * spots)} for ${spots} spots only if the organiser accepts you.`}{' '}
              You then have 5 minutes to pay.
            </Text>
          </View>
          <Button label={spots === 1 ? 'Send request' : `Send request · ${spots} spots`} onPress={send} loading={join.isPending} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** "5-a-side" → 10 players (same rule as the server). */
export const squadSize = (format: string) => {
  const m = /^(\d+)-a-side$/.exec(format);
  return m ? Math.min(Number(m[1]) * 2, 30) : 10;
};

/**
 * Open spots on a confirmed booking: name, level, how many spots. The price per player is
 * the booking total split across the squad (the server sets it; shown here as a preview).
 */
export function CreateMatchSheet({
  booking,
  onClose,
}: {
  booking: { id: string; amountPaid: number; format: string; start: number } | null;
  onClose: () => void;
}) {
  const players = squadSize(booking?.format ?? '5-a-side');
  const hour = Math.floor((booking?.start ?? 0) / 60) % 24;
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<MatchLevel>('casual');
  const [spots, setSpots] = useState(2);
  const create = useCreateMatch();
  const share = booking ? Math.ceil(booking.amountPaid / players / 100) * 100 : 0;
  const open = () => {
    if (!booking) return;
    create.mutate(
      { bookingId: booking.id, title: title.trim() || undefined, level, openSpots: spots },
      {
        onSuccess: (m) => {
          haptic.success();
          onClose();
          router.push({ pathname: '/match/[id]', params: { id: m.id } });
        },
        onError: (e) => {
          haptic.error();
          Alert.alert('Could not open spots', e.message);
        },
      },
    );
  };
  return (
    <Sheet visible={!!booking} onClose={onClose}>
      {booking ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text variant="h2">Find players</Text>
            <Text variant="label" color={colors.textMuted}>
              Open spots on this booking. Players nearby ask to join; you choose who plays.
            </Text>
          </View>
          <Input label="Match name" value={title} onChangeText={setTitle} placeholder={`${part} ${booking.format}`} maxLength={60} />
          <Text variant="labelStrong">Level</Text>
          <View style={styles.choices}>
            {LEVELS.map((l) => (
              <Chip key={l.key} label={l.label} active={level === l.key} tone="dark" onPress={() => setLevel(l.key)} />
            ))}
          </View>
          <View style={styles.stepRow}>
            <View style={styles.flex}>
              <Text variant="labelStrong">Open spots</Text>
              <Text variant="caption" color={colors.textMuted}>
                Your group fills the other {players - spots} of {players}
              </Text>
            </View>
            <IconButton icon={Minus} label="Fewer spots" variant="light" onPress={() => setSpots((n) => Math.max(1, n - 1))} />
            <Text variant="number" style={styles.stepValue}>
              {spots}
            </Text>
            <IconButton icon={Plus} label="More spots" variant="light" onPress={() => setSpots((n) => Math.min(players - 1, n + 1))} />
          </View>
          <View style={styles.note}>
            <Check size={16} color={colors.limeText} strokeWidth={2.4} />
            <Text variant="label" color={colors.textMuted} style={styles.flex}>
              Each player pays {formatTaka(share)}, the booking split {players} ways. Nobody pays more than their share.
            </Text>
          </View>
          <Button label={`Open ${spots} spot${spots === 1 ? '' : 's'}`} onPress={open} loading={create.isPending} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** "9:30 PM" in Dhaka time. */
export const clockLabel = (ms: number) => formatClock(Math.floor(ms / 60_000 + 6 * 60) % 1440); // Dhaka is UTC+6, no DST

const styles = createStyles(() => ({
  flex: { flex: 1 },
  card: { borderRadius: radius.xl, overflow: 'hidden' },
  top: { flexDirection: 'row', gap: space[3], padding: space[3] },
  photo: { width: 104, height: 104, borderRadius: radius.md },
  info: { flex: 1, gap: 5, paddingTop: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  titleText: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tags: { flexDirection: 'row', gap: space[2], marginTop: 3, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tagText: { color: colors.text },
  spots: { flexShrink: 0, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.limeSoft },
  spotsText: { fontFamily: font.semibold },
  spotsMuted: { backgroundColor: colors.surfaceMuted },
  divider: { marginHorizontal: space[3] },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[3], paddingTop: space[3] },
  faces: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  faceRow: { flexDirection: 'row', alignItems: 'center' },
  action: { padding: space[3], paddingTop: space[3], gap: space[2] },
  state: { minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space[2], paddingHorizontal: space[4] },
  stateIn: { backgroundColor: colors.limeSoft },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 8, borderRadius: 4 },
  segIn: { backgroundColor: colors.lime },
  segHeld: { backgroundColor: colors.limeSoft, borderWidth: 1, borderColor: colors.lime },
  segOpen: { backgroundColor: colors.surfaceMuted },
  sheet: { padding: space[5], gap: space[3] },
  sheetHead: { gap: space[1], marginBottom: space[1] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  note: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', paddingVertical: space[1] },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stepValue: { minWidth: 28, textAlign: 'center' },
}));
