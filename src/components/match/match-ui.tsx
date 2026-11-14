import { router } from 'expo-router';
import { ArrowRight, CalendarDays, Check, CircleCheck, Clock3, Eye, MapPin, Minus, Plus, RotateCcw, Settings2 } from 'lucide-react-native';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Alert } from '@/components/ui/dialog';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { Input, PhoneInput } from '@/components/ui/input';
import { formatPhone } from '@/components/match/contact-row';
import { Photo } from '@/components/ui/photo';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useCreateMatch, useJoinMatch, useLeaveMatch } from '@/features/api/queries';
import type { Match, MatchLevel, MatchPosition } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { formatTaka } from '@/lib/money';
import { dhakaToday, formatClock, formatDay, formatRange, type DayKey } from '@/lib/time';
import { colors, font, radius, size, space } from '@/theme/tokens';
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
    <View style={[styles.state, compact && styles.stateSm, inSquad && styles.stateIn, fill && styles.flex]}>
      {inSquad ? <CircleCheck size={18} color={colors.limeText} strokeWidth={2} /> : null}
      <Text variant={inSquad ? 'labelStrong' : 'label'} color={inSquad ? colors.limeText : colors.textMuted} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  const grow = fill ? styles.flex : undefined;

  switch (m.my) {
    case 'owner':
      return <Button small={compact} label="Manage match" variant="outline" icon={Settings2} style={grow} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })} />;
    case 'pending':
      return <Button small={compact} label={compact ? 'Withdraw' : 'Request sent · Withdraw'} variant="outline" icon={Clock3} loading={leave.isPending} style={grow} onPress={withdraw} />;
    case 'accepted':
      return (
        <Button
          small={compact}
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
      return <Button small={compact} label={again ? 'Request again' : 'Request to join'} variant="dark" icon={again ? RotateCcw : undefined} style={grow} onPress={() => onJoin(m)} />;
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

/** Players see the match details; the organiser goes straight to managing their match. */
const openDetails = (id: string, owner = false) =>
  owner ? router.push({ pathname: '/match/[id]', params: { id } }) : router.push({ pathname: '/game/[id]', params: { id } });

/** A game in the feed: tap it (or View) for the full details. */
export const MatchCard = memo(function MatchCard({ m }: { m: Match }) {
  const full = m.spotsLeft === 0;
  const pill = statusPill(m);
  const muted = (full && m.my !== 'paid' && m.my !== 'accepted') || m.my === 'declined';

  return (
    <Card style={styles.card} padded={false}>
      <Pressable style={styles.top} onPress={() => openDetails(m.id, m.my === 'owner')} accessibilityRole="button" accessibilityLabel={`View ${m.title}`}>
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
        {m.my === 'owner' ? (
          <Button label="Manage match" variant="outline" icon={Settings2} small onPress={() => openDetails(m.id, true)} />
        ) : (
          <Button label="View" variant="outline" icon={Eye} small onPress={() => openDetails(m.id)} />
        )}
      </View>
    </Card>
  );
});

/** Ask to join: position and level (the organiser sees both). You only pay once accepted. */
/** `spots`: how many places the player asks for (themselves + friends). */
export function JoinSheet({ match, spots = 1, onClose }: { match: Match | null; spots?: number; onClose: () => void }) {
  const [position, setPosition] = useState<MatchPosition>('any');
  const [level, setLevel] = useState<MatchLevel>('casual');
  const [sharePhone, setSharePhone] = useState(false);
  // Which number the organiser sees: the account's, or another one just for this game.
  const number = useNumberChoice();
  // Fresh agreement each time the sheet opens for a game.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if ((match?.id ?? null) !== openFor) {
    setOpenFor(match?.id ?? null);
    setSharePhone(false);
    number.reset();
  }
  const join = useJoinMatch();
  const canSend = sharePhone && number.ok;
  const send = () => {
    if (!match || !canSend) return;
    join.mutate(
      { id: match.id, position, level, spots, contactPhone: number.value },
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
          <PhoneConsent role="player" checked={sharePhone} onChange={setSharePhone}>
            <NumberChoice choice={number} audience="The organiser" />
          </PhoneConsent>
          <Button
            label={spots === 1 ? 'Send request' : `Send request · ${spots} spots`}
            onPress={send}
            loading={join.isPending}
            disabled={!canSend}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * Agreement to share your phone number inside a squad. Organiser ⇄ paid players only:
 * players never see each other's numbers. Required before opening spots or asking to join.
 */
function PhoneConsent({
  checked,
  onChange,
  role,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  role: 'host' | 'player';
  children?: ReactNode;
}) {
  return (
    <View style={[styles.consent, checked && styles.consentOn]}>
      <Checkbox checked={checked} onChange={onChange}>
        <Text variant="labelStrong">Share my phone number</Text>
        <Text variant="caption" color={colors.textMuted} style={styles.consentBody}>
          {role === 'host'
            ? 'Players who pay to join this game will see your number, so they can reach you. Players who only ask to join won’t.'
            : 'Once you’ve paid, the organiser sees your number and you see theirs. Other players in the squad never see it.'}
        </Text>
      </Checkbox>
      {checked ? children : null}
    </View>
  );
}

/** Share the account's number, or a different one just for this squad. */
function useNumberChoice() {
  const [other, setOther] = useState(false);
  const [phone, setPhone] = useState('');
  const valid = /^1[3-9]\d{8}$/.test(phone);
  return {
    other,
    setOther,
    phone,
    setPhone,
    valid,
    ok: !other || valid,
    /** 10 national digits when a different number is chosen; otherwise the account's is used. */
    value: other && valid ? phone : undefined,
    reset: () => {
      setOther(false);
      setPhone('');
    },
  };
}

function NumberChoice({ choice, audience }: { choice: ReturnType<typeof useNumberChoice>; audience: string }) {
  const { user } = useSession();
  return (
    <View style={styles.numberPick}>
      <View style={styles.choices}>
        <Chip label="My number" small active={!choice.other} tone="dark" onPress={() => choice.setOther(false)} />
        <Chip label="Different number" small active={choice.other} tone="dark" onPress={() => choice.setOther(true)} />
      </View>
      {choice.other ? (
        <PhoneInput
          value={choice.phone}
          onChangeText={choice.setPhone}
          error={choice.phone.length === 10 && !choice.valid ? 'Enter a valid Bangladesh mobile number.' : undefined}
          hint="Only for this squad. Your account number stays private."
        />
      ) : user?.phone ? (
        <Text variant="label" color={colors.textMuted}>
          {audience} will see {formatPhone(user.phone)}
        </Text>
      ) : null}
    </View>
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
  const [spots, setSpots] = useState(1);
  const [sharePhone, setSharePhone] = useState(false);
  // Which number players see: the account's, or another one just for this squad.
  const number = useNumberChoice();
  // Each time the sheet opens for a booking, start fresh: one open spot, no name, casual.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if ((booking?.id ?? null) !== openFor) {
    setOpenFor(booking?.id ?? null);
    if (booking) {
      setSpots(1);
      setTitle('');
      setLevel('casual');
      setSharePhone(false);
      number.reset();
    }
  }
  const create = useCreateMatch();
  const canOpen = sharePhone && number.ok;
  const share = booking ? Math.ceil(booking.amountPaid / players / 100) * 100 : 0;
  const open = () => {
    if (!booking || !canOpen) return;
    create.mutate(
      { bookingId: booking.id, title: title.trim() || undefined, level, openSpots: spots, contactPhone: number.value },
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
          <PhoneConsent role="host" checked={sharePhone} onChange={setSharePhone}>
            <NumberChoice choice={number} audience="Players" />
          </PhoneConsent>
          <Button label={`Open ${spots} spot${spots === 1 ? '' : 's'}`} onPress={open} loading={create.isPending} disabled={!canOpen} />
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
  stateSm: { minHeight: size.controlSm },
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
  consent: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] },
  consentOn: { borderColor: colors.lime, backgroundColor: colors.limeSoft },
  consentBody: { marginTop: 2 },
  numberPick: { gap: space[2], marginTop: space[3], marginBottom: space[1] },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stepValue: { minWidth: 28, textAlign: 'center' },
}));
