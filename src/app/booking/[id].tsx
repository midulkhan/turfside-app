import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Maximize2, MapPin, Navigation, Share2, Ticket, X } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Share, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { CreateMatchSheet } from '@/components/match/match-ui';
import { TicketDivider, TicketSurface } from '@/components/ticket/notch';
import { QRCode, QRPopup } from '@/components/ticket/qr-code';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Overline, ScreenHeader } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useBooking, useCancelBooking } from '@/features/api/queries';
import type { OtherTicket } from '@/features/api/types';
import { errorMessage } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { formatTaka } from '@/lib/money';
import { dhakaInstant, formatDuration, formatRange, weekday, dayOfMonth } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Slots that weren't back to back become separate tickets, though paid for together.
 * Each opens its own ticket (and pass).
 */
function OtherTickets({ tickets }: { tickets: OtherTicket[] }) {
  return (
    <View style={styles.others}>
      <Overline>Also in this payment</Overline>
      {tickets.map((t) => (
        <PressableScale
          key={t.id}
          scaleTo={0.985}
          onPress={() => router.setParams({ id: t.id })}
          accessibilityRole="button"
          accessibilityLabel={`Ticket for ${weekday(t.day)} ${dayOfMonth(t.day)}, ${formatRange(t.start, t.end)}`}>
          <Card style={styles.otherRow}>
            <Ticket size={20} color={colors.ink} strokeWidth={1.8} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1} style={t.status === 'cancelled' && styles.struck}>
                {weekday(t.day)} {dayOfMonth(t.day)} · {formatRange(t.start, t.end)}
              </Text>
              <Text variant="caption" color={colors.textMuted}>
                {t.status === 'cancelled' ? 'Cancelled' : `Ticket ${t.code}`}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Card>
        </PressableScale>
      ))}
    </View>
  );
}

export default function BookingTicket() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const insets = useSafeAreaInsets();
  const scrolled = useScrolled();
  const { data: b, isError, error, refetch } = useBooking(id);
  const justBooked = fresh === '1';
  const cancel = useCancelBooking();
  const [finding, setFinding] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [openedAt] = useState(() => Date.now()); // fixed per visit; the server re-checks the 24 h rule

  const close = () => (justBooked ? router.dismissTo('/bookings') : router.back());

  if (isError) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space[8] }]}>
        <ErrorState message={error.message} onRetry={refetch} />
      </View>
    );
  }

  const share = () =>
    b &&
    Share.share({
      message: `Game on! ${b.venue.name}, ${weekday(b.day)} ${dayOfMonth(b.day)} · ${formatRange(b.start, b.end)}. Booking ${b.code} on TurfSides.`,
    });
  const canCancel = !!b && b.status === 'confirmed' && dhakaInstant(b.day, b.start) - openedAt > 24 * 3600_000;
  const askCancel = () =>
    b &&
    Alert.alert('Cancel this booking?', `The slot is released and ${formatTaka(b.amountPaid)} is refunded to your bKash account.`, [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: () =>
          cancel.mutate(
            { id: b.id, venueId: b.venue.id, day: b.day },
            {
              onSuccess: () => haptic.success(),
              onError: (e) => {
                haptic.error();
                Alert.alert('Couldn’t cancel', errorMessage(e));
              },
            },
          ),
      },
    ]);
  const directions = () =>
    b && Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${b.venue.latitude},${b.venue.longitude}`);

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Your ticket" leftIcon={X} onBack={close} right={<IconButton icon={Share2} label="Share booking" onPress={share} />} />
      </StickyHeader>
      <ScrollView
        onScroll={scrolled.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: space[2], paddingBottom: insets.bottom + space[6] }]}
        showsVerticalScrollIndicator={false}>

        {justBooked ? (
          <Animated.View entering={FadeInDown.duration(320)} style={styles.hello}>
            <Animated.View entering={ZoomIn.delay(120).springify()} style={styles.check}>
              <Check size={24} color={colors.charcoal} strokeWidth={3} />
            </Animated.View>
            <View style={styles.flex}>
              <Text variant="h1">You’re all set.</Text>
              <Text variant="label" color={colors.textMuted}>
                Your pitch. Your people. Game on.
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {b ? (
          // Everything arrives together: no icons, labels or buttons before the booking itself.
          <Animated.View entering={FadeIn.duration(260)} style={styles.stack}>
          <Overline>{b?.status === 'cancelled' ? 'Booking cancelled' : b?.status === 'completed' ? 'Played' : 'Booking confirmed'}</Overline>

          {/* Ticket */}
          <View>
            <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.lg} notch={13} style={styles.ticket}>
              <Photo source={b.venue.photo} style={styles.photo} />
              {b ? (
                <View style={styles.formatBadge}>
                  <Text variant="labelStrong" color={colors.textOnDark}>
                    {b.venue.formats[0]}
                  </Text>
                </View>
              ) : null}
              <View style={styles.ticketBody}>
                <Text variant="h3" style={styles.venueName}>
                  {b?.venue.name ?? ' '}
                </Text>
                <View style={styles.row}>
                  <MapPin size={18} color={colors.ink} strokeWidth={1.8} />
                  <Text variant="body" color={colors.textMuted}>
                    {b ? `${b.venue.area}, ${b.venue.city}` : ''}
                  </Text>
                </View>
                <View style={styles.when}>
                  <View style={styles.whenCol}>
                    <CalendarDays size={22} color={colors.ink} strokeWidth={1.7} />
                    <View style={styles.whenText}>
                      <Text variant="bodyStrong" style={styles.caps} numberOfLines={1}>
                        {b ? `${weekday(b.day).toUpperCase()}, ${dayOfMonth(b.day)} ${MONTHS[Number(b.day.slice(5, 7)) - 1]}` : ' '}
                      </Text>
                      <Text variant="label" color={colors.textMuted}>
                        {b?.day.slice(0, 4)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.vr} />
                  <View style={styles.whenCol}>
                    <Clock3 size={22} color={colors.ink} strokeWidth={1.7} />
                    <View style={styles.whenText}>
                      <Text variant="bodyStrong" style={styles.caps} numberOfLines={1}>
                        {b ? formatRange(b.start, b.end) : ' '}
                      </Text>
                      <Text variant="label" color={colors.textMuted}>
                        {b ? formatDuration(b.end - b.start) : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
              <TicketDivider />
              <View style={styles.pass}>
                <View style={styles.flex}>
                  <View style={styles.passBadge}>
                    <Text variant="caption" style={styles.passBadgeText}>
                      YOUR ENTRY PASS
                    </Text>
                  </View>
                  <Text variant="h2" color={colors.textOnDark} style={styles.code} adjustsFontSizeToFit numberOfLines={1}>
                    {b?.code ?? ' '}
                  </Text>
                  <Text variant="label" color={colors.textOnDarkMuted}>
                    Show this code at reception
                  </Text>
                </View>
                <View style={styles.passRule} />
                {b.passToken ? (
                  <Pressable
                    onPress={() => {
                      haptic.select();
                      setQrOpen(true);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Enlarge entry pass QR code"
                    style={({ pressed }) => [styles.qrTap, pressed && styles.qrPressed]}>
                    <QRCode value={b.passToken} size={84} />
                    <View style={styles.qrExpand}>
                      <Maximize2 size={12} color={colors.charcoal} strokeWidth={2.6} />
                    </View>
                  </Pressable>
                ) : (
                  // Cancelled or played: the pass is no longer valid, so no QR is shown.
                  <View style={styles.noPass}>
                    <X size={28} color={colors.textOnDarkMuted} />
                  </View>
                )}
              </View>
            </TicketSurface>
          </View>

          {b ? (
            <View style={styles.paid}>
              <Check size={20} color={colors.charcoal} strokeWidth={2.6} />
              <Text variant="bodyStrong" color={colors.charcoal} style={styles.flex}>
                Paid {formatTaka(b.amountPaid)}
              </Text>
              <Text variant="label" color={colors.charcoal} style={styles.onLimeMuted}>
                via {b.method}
              </Text>
            </View>
          ) : null}

          <Button label="Directions" icon={Navigation} variant="light" onPress={directions} />

          {b.otherTickets?.length ? <OtherTickets tickets={b.otherTickets} /> : null}

          {/* Find players: open spots on this booking (or manage the ones already open). */}
          {b.status === 'confirmed' || b.matchId ? (
            <PressableScale
              scaleTo={0.99}
              accessibilityRole="button"
              onPress={() => (b.matchId ? router.push({ pathname: '/match/[id]', params: { id: b.matchId } }) : setFinding(true))}>
              <Card tone="lime" style={styles.tip}>
                <AvatarStack names={['Rafi Ahmed', 'Sami Khan', 'Tanvir Islam']} size={38} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" color={colors.charcoal}>
                    {b.matchId ? 'Manage your squad' : 'Need more players?'}
                  </Text>
                  <Text variant="label" color={colors.charcoal} style={styles.onLimeMuted}>
                    {b.matchId ? 'See requests and who has paid' : 'Open spots and let players nearby join'}
                  </Text>
                </View>
                <View style={styles.darkArrow}>
                  <ArrowRight size={18} color={colors.lime} strokeWidth={2.6} />
                </View>
              </Card>
            </PressableScale>
          ) : null}

          <Pressable accessibilityRole="link" onPress={() => router.dismissTo('/explore')} style={styles.back}>
            <Text variant="bodyStrong" style={styles.u}>
              Back to explore
            </Text>
          </Pressable>
          {canCancel ? (
            <Pressable accessibilityRole="button" onPress={askCancel} disabled={cancel.isPending} style={styles.back}>
              <Text variant="label" color={colors.danger}>
                {cancel.isPending ? 'Cancelling…' : 'Cancel booking'}
              </Text>
            </Pressable>
          ) : null}
          </Animated.View>
        ) : (
          <TicketSkeleton />
        )}
      </ScrollView>
      <CreateMatchSheet
        booking={finding && b ? { id: b.id, amountPaid: b.amountPaid, format: b.venue.formats[0] ?? '5-a-side', start: b.start } : null}
        onClose={() => setFinding(false)}
      />
      {b?.passToken ? (
        <QRPopup
          visible={qrOpen}
          value={b.passToken}
          code={b.code}
          title={b.venue.name}
          subtitle={`${weekday(b.day)} ${dayOfMonth(b.day)} · ${formatRange(b.start, b.end)}`}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** Same shape as the ticket, all placeholders: shown until the booking has loaded. */
function TicketSkeleton() {
  return (
    <View style={styles.stack} accessibilityLabel="Loading your ticket">
      <Skeleton width={140} height={12} />
      <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.lg} notch={13} style={styles.ticket}>
        <Skeleton height={180} r={radius.md} />
        <View style={[styles.ticketBody, styles.skelBody]}>
          <Skeleton width="62%" height={22} />
          <Skeleton width="44%" height={16} />
          <View style={styles.skelWhen}>
            <Skeleton width="40%" height={40} />
            <Skeleton width="40%" height={40} />
          </View>
        </View>
        <TicketDivider />
        <View style={[styles.pass, styles.skelPass]}>
          <View style={[styles.flex, styles.skelPassText]}>
            <Skeleton width={128} height={20} r={radius.xs} />
            <Skeleton width="80%" height={22} />
            <Skeleton width="70%" height={14} />
          </View>
          <Skeleton width={96} height={96} />
        </View>
      </TicketSurface>
      <Skeleton height={56} r={radius.lg} />
      <View style={styles.actions}>
        <Skeleton height={56} r={radius.pill} style={styles.flex} />
        <Skeleton height={56} r={radius.pill} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, gap: space[4] },
  flex: { flex: 1 },
  stack: { gap: space[4] },
  skelBody: { gap: space[3], paddingBottom: space[4] },
  skelWhen: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  skelPass: { backgroundColor: colors.surfaceMuted },
  skelPassText: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[2] },
  check: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  ticket: { padding: 6 },
  photo: { height: 180 },
  formatBadge: {
    position: 'absolute',
    right: space[4],
    top: space[4],
    backgroundColor: 'rgba(22,27,29,0.85)',
    borderRadius: radius.xs,
    paddingHorizontal: space[3],
    height: 30,
    justifyContent: 'center',
  },
  ticketBody: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[2] },
  venueName: { fontSize: 20, lineHeight: 26 },
  when: { flexDirection: 'row', alignItems: 'center', marginTop: space[3], marginBottom: space[4] },
  whenCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  whenText: { flex: 1 },
  caps: { fontFamily: 'Geist_700Bold', fontSize: 15 },
  vr: { width: 1, height: 44, backgroundColor: colors.border, marginHorizontal: space[2] },
  others: { gap: space[2] },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  struck: { textDecorationLine: 'line-through' },
  pass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: colors.inverse,
    borderRadius: radius.md,
    padding: space[4],
    marginTop: 6,
  },
  passBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: radius.xs,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    marginBottom: space[2],
  },
  passBadgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1.6, color: colors.charcoal },
  onLimeMuted: { opacity: 0.7 },
  code: { fontFamily: 'Geist_700Bold', fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  passRule: { width: 1, alignSelf: 'stretch', backgroundColor: colors.borderOnDark },
  qrTap: { position: 'relative' },
  qrPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  qrExpand: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.lime,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    height: 56,
  },
  actions: { flexDirection: 'row', gap: space[3] },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space[4], paddingVertical: space[4] },
  darkArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' },
  back: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  noPass: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  u: { textDecorationLine: 'underline' },
}));
