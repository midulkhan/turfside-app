import { router } from 'expo-router';
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleCheck, Clock3, Eye, MapPin, Minus, Plus, RotateCcw, Settings2, Swords, UsersRound } from 'lucide-react-native';
import { memo, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, View } from 'react-native';

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
import type { Match, MatchLevel, MatchPosition, MatchType } from '@/features/api/types';
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
/** Looking for a whole opposing team (not single players). */
export const isOpponent = (m: Pick<Match, 'type'>) => m.type === 'opponent';
/** "5-a-side" → "5 v 5". */
export const versusLabel = (format: string) => {
  const n = /^(\d+)-a-side$/.exec(format)?.[1];
  return n ? `${n} v ${n}` : format;
};

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

  const opp = isOpponent(m);
  switch (m.my) {
    case 'owner':
      return <Button small={compact} label="Manage match" variant="outline" icon={Settings2} style={grow} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id } })} />;
    case 'pending':
      return (
        <Button
          small={compact}
          label={compact ? 'Withdraw' : opp ? 'Challenge sent · Withdraw' : 'Request sent · Withdraw'}
          variant="outline"
          icon={Clock3}
          loading={leave.isPending}
          style={grow}
          onPress={withdraw}
        />
      );
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
      return state(opp ? 'Game on: your team plays' : "You're in the squad", true);
    default: {
      if (full) return state(opp ? 'An opponent was found' : 'This game is full');
      if (m.status !== 'open') return state(opp ? 'Challenges are paused' : 'Requests are paused');
      // Declined, or the pay window ran out: they can ask again while spots are open.
      const again = m.my === 'declined' || m.my === 'expired';
      const label = opp ? (again ? 'Challenge again' : 'Challenge') : again ? 'Request again' : 'Request to join';
      return <Button small={compact} label={label} variant="dark" icon={again ? RotateCcw : opp ? Swords : undefined} style={grow} onPress={() => onJoin(m)} />;
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
      return isOpponent(m) ? 'Challenged' : 'Requested';
    case 'declined':
      return 'Not this time';
  }
  if (isOpponent(m)) return m.spotsLeft === 0 ? 'Matched' : 'Opponent wanted';
  return m.spotsLeft === 0 ? 'Full' : spotsLabel(m.spotsLeft);
}

/** "Team vs Team" badge on opponent posts. */
export function VsTag() {
  return (
    <View style={[styles.tag, styles.vsTag]}>
      <Swords size={12} color={colors.charcoal} strokeWidth={2.2} />
      <Text variant="caption" style={styles.vsText}>
        Team vs Team
      </Text>
    </View>
  );
}

/** Opponent card footer: the host's team, and the opponent once one has paid. */
function TeamLine({ m }: { m: Match }) {
  const host = m.faces[0];
  return (
    <View style={styles.faces}>
      <Avatar name={host?.name ?? m.teamName ?? 'Team'} uri={host?.avatar ?? null} size={36} ring={colors.surface} />
      <View style={styles.teamText}>
        <Text variant="labelStrong" numberOfLines={1}>
          {m.teamName ?? 'Host team'}
        </Text>
        <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
          {m.opponent ? `vs ${m.opponent.teamName}` : 'vs your team?'}
        </Text>
      </View>
    </View>
  );
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
            {isOpponent(m) ? <VsTag /> : null}
            <Tag label={isOpponent(m) ? versusLabel(m.format) : m.format} />
            <Tag label={levelLabel(m.level)} />
          </View>
        </View>
      </Pressable>
      <Divider style={styles.divider} />
      <View style={styles.bottom}>
        {isOpponent(m) ? <TeamLine m={m} /> : <Faces m={m} />}
        <Text variant="title">
          {formatTaka(m.share)}
          <Text variant="label" color={colors.textMuted}>
            {' '}
            {isOpponent(m) ? '/ team' : '/ player'}
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
  // Keep the last game while the sheet slides away, so the right sheet closes smoothly.
  const [last, setLast] = useState<Match | null>(match);
  if (match && match !== last) setLast(match);
  if (last && isOpponent(last)) return <ChallengeSheet match={last} visible={!!match} onClose={onClose} />;
  return <PlayerJoinSheet match={match} spots={spots} onClose={onClose} />;
}

/** Challenge an opponent post: your team's name, size and level. Your team pays only if accepted. */
function ChallengeSheet({ match, visible, onClose }: { match: Match; visible: boolean; onClose: () => void }) {
  const side = Math.floor(match.playersTotal / 2);
  const [teamName, setTeamName] = useState('');
  const [size, setSize] = useState(side);
  const [level, setLevel] = useState<MatchLevel>(match.level);
  const [sharePhone, setSharePhone] = useState(false);
  const number = useNumberChoice();
  // Fresh each time it opens (the team name is kept: captains usually challenge as the same team).
  const [wasOpen, setWasOpen] = useState(false);
  if (visible !== wasOpen) {
    setWasOpen(visible);
    if (visible) {
      setSize(side);
      setLevel(match.level);
      setSharePhone(false);
      number.reset();
    }
  }
  const join = useJoinMatch();
  const canSend = sharePhone && number.ok && teamName.trim().length >= 2;
  const send = () => {
    if (!canSend) return;
    join.mutate(
      { id: match.id, position: 'any', level, spots: 1, teamName: teamName.trim(), teamSize: size, contactPhone: number.value },
      {
        onSuccess: () => {
          haptic.success();
          onClose();
        },
        onError: (e) => {
          haptic.error();
          Alert.alert('Challenge not sent', e.message);
        },
      },
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text variant="h2">{match.my === 'declined' || match.my === 'expired' ? 'Challenge again' : `Challenge ${match.teamName ?? 'this team'}`}</Text>
          <Text variant="label" color={colors.textMuted}>
            {match.venue.name} · {whenLabel(match)} · {versusLabel(match.format)}
          </Text>
        </View>
        <Input label="Your team name" value={teamName} onChangeText={setTeamName} placeholder="E.g. Uttara Kings" maxLength={40} autoCapitalize="words" />
        <View style={styles.stepRow}>
          <View style={styles.flex}>
            <Text variant="labelStrong">Players in your team</Text>
            <Text variant="caption" color={colors.textMuted}>
              Up to {side} for {match.format}
            </Text>
          </View>
          <IconButton icon={Minus} label="Fewer players" variant="light" onPress={() => setSize((n) => Math.max(1, n - 1))} />
          <Text variant="number" style={styles.stepValue}>
            {size}
          </Text>
          <IconButton icon={Plus} label="More players" variant="light" onPress={() => setSize((n) => Math.min(side, n + 1))} />
        </View>
        <Text variant="labelStrong">Your team’s level</Text>
        <View style={styles.choices}>
          {LEVELS.map((l) => (
            <Chip key={l.key} label={l.label} active={level === l.key} tone="dark" onPress={() => setLevel(l.key)} />
          ))}
        </View>
        <View style={styles.note}>
          <Check size={16} color={colors.limeText} strokeWidth={2.4} />
          <Text variant="label" color={colors.textMuted} style={styles.flex}>
            Your team pays {formatTaka(match.share)} only if the host accepts your challenge. You then have 5 minutes to pay.
          </Text>
        </View>
        <PhoneConsent role="captain" checked={sharePhone} onChange={setSharePhone}>
          <NumberChoice choice={number} audience="The host" />
        </PhoneConsent>
        <Button label="Send challenge" icon={Swords} onPress={send} loading={join.isPending} disabled={!canSend} />
      </View>
    </Sheet>
  );
}

function PlayerJoinSheet({ match, spots = 1, onClose }: { match: Match | null; spots?: number; onClose: () => void }) {
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
  role: 'host' | 'player' | 'opponentHost' | 'captain';
  children?: ReactNode;
}) {
  return (
    <View style={[styles.consent, checked && styles.consentOn]}>
      <Checkbox checked={checked} onChange={onChange}>
        <Text variant="labelStrong">Share my phone number</Text>
        <Text variant="caption" color={colors.textMuted} style={styles.consentBody}>
          {role === 'host'
            ? 'Players who pay to join this game will see your number, so they can reach you. Players who only ask to join won’t.'
            : role === 'opponentHost'
              ? 'The captain of the team that pays to play you will see your number. Teams that only challenge won’t.'
              : role === 'captain'
                ? 'Once your team has paid, the host sees your number and you see theirs. Nobody else does.'
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
          autoFocus
          value={choice.phone}
          onChangeText={(v) => {
            choice.setPhone(v);
            // A full, valid number: put the keyboard away so the button is right there.
            if (/^1[3-9]\d{8}$/.test(v)) Keyboard.dismiss();
          }}
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

/** What the opposing team can be asked to pay: their share of the turf. */
export const OPPONENT_SPLITS: { percent: 50 | 40 | 30; label: string }[] = [
  { percent: 50, label: 'Half' },
  { percent: 40, label: '40%' },
  { percent: 30, label: '30%' },
];
/** The opposing team's part of a booking total (rounded up to the taka, like the server). */
export const teamShare = (total: number, percent: number) => Math.ceil((total * percent) / 100 / 100) * 100;

/**
 * Post a confirmed booking to Find players. First choose what you need:
 *  - Need players: open spots; each player pays the booking split across the squad.
 *  - Find an opponent: one whole team challenges you and pays its share of the turf.
 * Prices are previews; the server sets them.
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
  const [type, setType] = useState<MatchType | null>(null);
  const [title, setTitle] = useState('');
  const [teamName, setTeamName] = useState('');
  const [percent, setPercent] = useState<50 | 40 | 30>(50);
  const [level, setLevel] = useState<MatchLevel>('casual');
  const [spots, setSpots] = useState(1);
  const [sharePhone, setSharePhone] = useState(false);
  // Which number players see: the account's, or another one just for this squad.
  const number = useNumberChoice();
  // Each time the sheet opens for a booking, start fresh at the first step.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if ((booking?.id ?? null) !== openFor) {
    setOpenFor(booking?.id ?? null);
    if (booking) {
      setType(null);
      setSpots(1);
      setTitle('');
      setTeamName('');
      setPercent(50);
      setLevel('casual');
      setSharePhone(false);
      number.reset();
    }
  }
  const create = useCreateMatch();
  const opponent = type === 'opponent';
  const canOpen = sharePhone && number.ok && (!opponent || teamName.trim().length >= 2);
  const share = booking ? Math.ceil(booking.amountPaid / players / 100) * 100 : 0;
  const theirs = booking ? teamShare(booking.amountPaid, percent) : 0;
  const open = () => {
    if (!booking || !canOpen || !type) return;
    create.mutate(
      opponent
        ? { bookingId: booking.id, type, teamName: teamName.trim(), opponentPercent: percent, level, title: title.trim() || undefined, contactPhone: number.value }
        : { bookingId: booking.id, type, title: title.trim() || undefined, level, openSpots: spots, contactPhone: number.value },
      {
        onSuccess: (m) => {
          haptic.success();
          onClose();
          router.push({ pathname: '/match/[id]', params: { id: m.id } });
        },
        onError: (e) => {
          haptic.error();
          Alert.alert(opponent ? 'Could not post your challenge' : 'Could not open spots', e.message);
        },
      },
    );
  };
  return (
    <Sheet visible={!!booking} onClose={onClose}>
      {booking && !type ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text variant="h2">What do you need?</Text>
            <Text variant="label" color={colors.textMuted}>
              Post this booking so others nearby can find it.
            </Text>
          </View>
          <TypeChoice
            icon={UsersRound}
            title="Need players"
            body="Fill open spots in your squad. Each player pays their share."
            onPress={() => setType('players')}
          />
          <TypeChoice
            icon={Swords}
            title="Find an opponent"
            body="Challenge another team to play you. They pay part of the turf."
            onPress={() => setType('opponent')}
          />
        </View>
      ) : booking && type ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Pressable accessibilityRole="button" onPress={() => setType(null)} hitSlop={8} style={styles.backRow}>
              <ChevronLeft size={16} color={colors.textMuted} strokeWidth={2} />
              <Text variant="label" color={colors.textMuted}>
                {opponent ? 'Find an opponent' : 'Need players'}
              </Text>
            </Pressable>
            <Text variant="h2">{opponent ? 'Challenge a team' : 'Find players'}</Text>
            <Text variant="label" color={colors.textMuted}>
              {opponent
                ? 'Teams nearby challenge you; you pick the one you play.'
                : 'Open spots on this booking. Players nearby ask to join; you choose who plays.'}
            </Text>
          </View>
          {opponent ? (
            <Input label="Your team name" value={teamName} onChangeText={setTeamName} placeholder="E.g. Badda FC" maxLength={40} autoCapitalize="words" />
          ) : (
            <Input label="Match name" value={title} onChangeText={setTitle} placeholder={`${part} ${booking.format}`} maxLength={60} />
          )}
          <Text variant="labelStrong">{opponent ? 'Your team’s level' : 'Level'}</Text>
          <View style={styles.choices}>
            {LEVELS.map((l) => (
              <Chip key={l.key} label={l.label} active={level === l.key} tone="dark" onPress={() => setLevel(l.key)} />
            ))}
          </View>
          {opponent ? (
            <>
              <Text variant="labelStrong">The other team pays</Text>
              <View style={styles.choices}>
                {OPPONENT_SPLITS.map((o) => (
                  <Chip key={o.percent} label={`${o.label} · ${formatTaka(teamShare(booking.amountPaid, o.percent))}`} active={percent === o.percent} tone="dark" onPress={() => setPercent(o.percent)} />
                ))}
              </View>
              <View style={styles.note}>
                <Check size={16} color={colors.limeText} strokeWidth={2.4} />
                <Text variant="label" color={colors.textMuted} style={styles.flex}>
                  The team you accept pays {formatTaka(theirs)} of your {formatTaka(booking.amountPaid)} booking. It plays {booking.format} against you.
                </Text>
              </View>
            </>
          ) : (
            <>
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
            </>
          )}
          <PhoneConsent role={opponent ? 'opponentHost' : 'host'} checked={sharePhone} onChange={setSharePhone}>
            <NumberChoice choice={number} audience={opponent ? 'Their captain' : 'Players'} />
          </PhoneConsent>
          <Button
            label={opponent ? 'Find an opponent' : `Open ${spots} spot${spots === 1 ? '' : 's'}`}
            icon={opponent ? Swords : undefined}
            onPress={open}
            loading={create.isPending}
            disabled={!canOpen}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

/** A big tappable option on the first step of posting. */
function TypeChoice({ icon: Icon, title, body, onPress }: { icon: typeof Swords; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => [styles.typeChoice, pressed && styles.typeChoicePressed]}>
      <View style={styles.typeIcon}>
        <Icon size={22} color={colors.charcoal} strokeWidth={1.9} />
      </View>
      <View style={styles.flex}>
        <Text variant="title">{title}</Text>
        <Text variant="label" color={colors.textMuted}>
          {body}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
    </Pressable>
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
  vsTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.lime },
  vsText: { color: colors.charcoal, fontFamily: font.semibold },
  teamText: { flexShrink: 1, minWidth: 0, maxWidth: 170 },
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
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: space[1] },
  typeChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChoicePressed: { backgroundColor: colors.surfaceMuted },
  typeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 28, textAlign: 'center' },
}));
