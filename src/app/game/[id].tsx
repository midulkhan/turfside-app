import { useLocalSearchParams } from 'expo-router';
import { CalendarDays, CircleCheck, Clock3, MapPin, Navigation, ShieldCheck, Share2, Undo2 } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JoinSheet, MatchAction, SquadBar, Tag, clockLabel, levelLabel, spotsLabel, whenLabel } from '@/components/match/match-ui';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { Photo } from '@/components/ui/photo';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useMatch } from '@/features/api/queries';
import type { Match } from '@/features/api/types';
import { formatTaka } from '@/lib/money';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { colors, font, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

/** A game's full details: when, where, who's in, who's hosting, and the viewer's next step. */
export default function GameDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  const q = useMatch(id);
  const pull = usePullToRefresh(q.refetch);
  const [joining, setJoining] = useState<Match | null>(null);
  const m = q.data;

  const share = () =>
    m &&
    Share.share({
      message: `Join ${m.title} at ${m.venue.name}, ${whenLabel(m)}. ${spotsLabel(m.spotsLeft)}, ${formatTaka(m.share)} per player. Open TurfSides → Find players.`,
    });

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Match details" right={m ? <IconButton icon={Share2} label="Share" onPress={share} /> : undefined} />
      </StickyHeader>

      {q.isError && !m ? (
        <ErrorState message={q.error.message} onRetry={q.refetch} />
      ) : (
        <>
          <ScrollView
            onScroll={scrolled.onScroll}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.ink} />}
            contentContainerStyle={[styles.content, { paddingBottom: space[6] }]}
            showsVerticalScrollIndicator={false}>
            {m ? <Body m={m} /> : <Loading />}
          </ScrollView>
          {m ? <PriceBar m={m} bottom={insets.bottom} onJoin={setJoining} /> : null}
        </>
      )}

      <JoinSheet match={joining} onClose={() => setJoining(null)} />
    </View>
  );
}

function Body({ m }: { m: Match }) {
  const full = m.spotsLeft === 0;
  const pill = m.my === 'paid' ? "You're in" : full ? 'Full' : spotsLabel(m.spotsLeft);
  const host = m.faces[0];
  const shown = m.faces.slice(0, 3);
  const extra = m.playersIn - shown.length;
  const place = [m.venue.area, m.venue.city].filter(Boolean).join(', ');

  const directions = () => {
    const { latitude: lat, longitude: lng } = m.venue;
    const query = lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(`${m.venue.name} ${place}`);
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  return (
    <>
      {/* Hero */}
      <View>
        <Photo source={m.venue.photo} style={styles.hero} rounded={radius.xl} recyclingKey={m.id} />
        <View style={[styles.heroPill, (full || m.my === 'paid') && styles.heroPillMuted]}>
          <Text variant="labelStrong" color={colors.charcoal}>
            {pill}
          </Text>
        </View>
      </View>

      {/* Title */}
      <View style={styles.titleBlock}>
        <Text variant="h1">{m.title}</Text>
        <View style={styles.tags}>
          <Tag label={m.format} />
          <Tag label={levelLabel(m.level)} />
        </View>
      </View>

      {/* When and where */}
      <Card padded={false}>
        <View style={styles.infoRow}>
          <CalendarDays size={20} color={colors.ink} strokeWidth={1.8} />
          <Text variant="bodyStrong" style={styles.flex}>
            {whenLabel(m).replace(', ', ' · ')}
          </Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.infoRow}>
          <MapPin size={20} color={colors.ink} strokeWidth={1.8} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {m.venue.name}
            </Text>
            {place ? (
              <Text variant="label" color={colors.textMuted} numberOfLines={1}>
                {place}
              </Text>
            ) : null}
          </View>
          <IconButton icon={Navigation} label="Directions" size={44} onPress={directions} />
        </View>
      </Card>

      {/* Squad */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text variant="h3">Squad</Text>
          <Text variant="label" color={colors.textMuted}>
            {m.playersIn} of {m.playersTotal} players
          </Text>
        </View>
        <View style={styles.faceRow}>
          {shown.map((f, i) => (
            <View key={`${f.name}:${i}`} style={{ marginLeft: i === 0 ? 0 : -12, zIndex: shown.length - i }}>
              <Avatar name={f.name} uri={f.avatar} size={52} ring={colors.bg} />
            </View>
          ))}
          {extra > 0 ? (
            <View style={[styles.more, { marginLeft: shown.length ? -12 : 0 }]}>
              <Text variant="labelStrong">+{extra}</Text>
            </View>
          ) : null}
        </View>
        <SquadBar total={m.playersTotal} inCount={m.playersIn} />
      </View>

      {/* How joining works */}
      <View style={styles.section}>
        <Text variant="h3">Good to know</Text>
        <View style={styles.points}>
          <Point icon={ShieldCheck} text="The turf is already booked and paid for by the organiser." />
          <Point icon={Clock3} text="Once you're accepted, you have up to 2 hours to pay your share." />
          <Point icon={Undo2} text="If the organiser cancels, your share is refunded in full." />
        </View>
      </View>

      {/* Host */}
      {host ? (
        <Card style={styles.hostCard}>
          <View style={styles.host}>
            <Avatar name={host.name} uri={host.avatar} size={48} />
            <View style={styles.flex}>
              <Text variant="caption" color={colors.textMuted}>
                Hosted by
              </Text>
              <Text variant="title" numberOfLines={1}>
                {m.my === 'owner' ? 'You' : host.name}
              </Text>
            </View>
          </View>
          <View style={styles.vline} />
          <View style={styles.confirmed}>
            <View style={styles.check}>
              <CircleCheck size={18} color={colors.charcoal} strokeWidth={2.2} />
            </View>
            <Text variant="labelStrong" color={colors.limeText} style={styles.confirmedText}>
              Booking confirmed
            </Text>
          </View>
        </Card>
      ) : null}
    </>
  );
}

function Point({ icon: Icon, text }: { icon: typeof Clock3; text: string }) {
  return (
    <View style={styles.point}>
      <Icon size={18} color={colors.limeText} strokeWidth={2} />
      <Text variant="body" color={colors.textMuted} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

/** Price and the viewer's next step, pinned to the bottom. */
function PriceBar({ m, bottom, onJoin }: { m: Match; bottom: number; onJoin: (m: Match) => void }) {
  const hint =
    m.my === 'accepted' && m.payBy
      ? `Accepted. Your spot is held until ${clockLabel(m.payBy)}`
      : m.my === 'none' || m.my === 'withdrawn' || m.my === 'expired'
        ? 'Pay only after the organiser accepts you.'
        : null;
  return (
    <View style={[styles.bar, { paddingBottom: bottom + space[3] }]}>
      <View style={styles.barRow}>
        <View style={styles.price}>
          <Text variant="h3" style={styles.priceText}>
            {formatTaka(m.share)}
          </Text>
          <Text variant="caption" color={colors.textMuted}>
            per player
          </Text>
        </View>
        <View style={styles.barLine} />
        <View style={styles.flex}>
          <MatchAction m={m} onJoin={onJoin} compact />
        </View>
      </View>
      {hint ? (
        <Text variant="caption" color={colors.textMuted} align="center">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Loading() {
  return (
    <>
      <Skeleton height={220} r={radius.xl} />
      <Skeleton height={34} width="70%" />
      <Skeleton height={130} r={radius.lg} />
      <Skeleton height={90} r={radius.lg} />
    </>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: gutter, paddingTop: space[2], gap: space[5] },
  hero: { width: '100%', height: 220 },
  heroPill: {
    position: 'absolute',
    top: space[3],
    right: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  heroPillMuted: { backgroundColor: 'rgba(255,255,255,0.92)' },
  titleBlock: { gap: space[3], marginTop: -space[1] },
  tags: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[4] },
  divider: { marginHorizontal: space[4] },
  section: { gap: space[3] },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faceRow: { flexDirection: 'row', alignItems: 'center' },
  more: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceMuted, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  points: { gap: space[3] },
  point: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  hostCard: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  host: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], minWidth: 0 },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  confirmedText: { flexShrink: 1 },
  bar: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: gutter,
    paddingTop: space[3],
    gap: space[2],
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  price: { gap: 0 },
  priceText: { fontFamily: font.bold },
  barLine: { width: 1, height: 36, backgroundColor: colors.border },
}));
