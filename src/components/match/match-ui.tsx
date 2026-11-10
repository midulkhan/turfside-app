import { router } from 'expo-router';
import { ArrowRight, CalendarDays, Check, CircleCheck, Clock3, MapPin, Minus, Plus, Settings2 } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Alert, View } from 'react-native';

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

/** A game in the feed. The button follows the viewer's status. */
export const MatchCard = memo(function MatchCard({ m, onJoin }: { m: Match; onJoin: (m: Match) => void }) {
  const leave = useLeaveMatch();
  const full = m.spotsLeft === 0;
  const pill = m.my === 'paid' ? "You're in" : full ? 'Full' : spotsLabel(m.spotsLeft);

  const withdraw = () =>
    Alert.alert('Withdraw your request?', 'Your spot goes back to the game.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => leave.mutate(m.id, { onError: (e) => Alert.alert('Could not withdraw', e.message) }) },
    ]);

  let action: React.ReactNode;
  switch (m.my) {
    case 'owner':
      action = <Button label="Manage match" variant="outline" icon={Settings2} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })} />;
      break;
    case 'pending':
      action = <Button label="Request sent · Withdraw" variant="outline" icon={Clock3} loading={leave.isPending} onPress={withdraw} />;
      break;
    case 'accepted':
      action = (
        <View style={styles.payWrap}>
          <Button
            label={`Pay ${formatTaka(m.share)} to confirm`}
            trailingIcon={ArrowRight}
            onPress={() => router.push({ pathname: '/checkout', params: { match: m.id } })}
          />
          {m.payBy ? (
            <Text variant="caption" color={colors.textMuted} align="center">
              Accepted. Your spot is held until {clockLabel(m.payBy)}
            </Text>
          ) : null}
        </View>
      );
      break;
    case 'paid':
      action = (
        <View style={[styles.state, styles.stateIn]}>
          <CircleCheck size={18} color={colors.limeText} strokeWidth={2} />
          <Text variant="labelStrong" color={colors.limeText}>
            You&apos;re in the squad
          </Text>
        </View>
      );
      break;
    case 'declined':
      action = (
        <View style={styles.state}>
          <Text variant="label" color={colors.textMuted}>
            The organiser couldn&apos;t fit you in this time
          </Text>
        </View>
      );
      break;
    default:
      action = full ? (
        <View style={styles.state}>
          <Text variant="label" color={colors.textMuted}>
            This game is full
          </Text>
        </View>
      ) : (
        <Button label="Request to join" variant="dark" trailingIcon={ArrowRight} onPress={() => onJoin(m)} />
      );
  }

  return (
    <Card style={styles.card} padded={false}>
      <View style={styles.top}>
        <Photo source={m.venue.photo} style={styles.photo} recyclingKey={m.id} />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text variant="title" numberOfLines={1} style={styles.titleText}>
              {m.title}
            </Text>
            <View style={[styles.spots, (full || m.my === 'paid') && styles.spotsMuted]}>
              <Text variant="caption" style={styles.spotsText} color={full && m.my !== 'paid' ? colors.textMuted : colors.limeText}>
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
      </View>
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
      <View style={styles.action}>{action}</View>
    </Card>
  );
});

/** Ask to join: position and level (the organiser sees both). You only pay once accepted. */
export function JoinSheet({ match, onClose }: { match: Match | null; onClose: () => void }) {
  const [position, setPosition] = useState<MatchPosition>('any');
  const [level, setLevel] = useState<MatchLevel>('casual');
  const join = useJoinMatch();
  const send = () => {
    if (!match) return;
    join.mutate(
      { id: match.id, position, level },
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
            <Text variant="h2">Join {match.title}</Text>
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
              You pay your {formatTaka(match.share)} share only if the organiser accepts you.
            </Text>
          </View>
          <Button label="Send request" onPress={send} loading={join.isPending} />
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
  action: { padding: space[3], paddingTop: space[3] },
  payWrap: { gap: space[2] },
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
