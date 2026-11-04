import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Download, MapPin, Navigation, Share2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/logo';
import { TicketDivider, TicketSurface } from '@/components/ticket/notch';
import { QRCode } from '@/components/ticket/qr-code';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Overline } from '@/components/ui/headers';
import { IconButton } from '@/components/ui/icon-button';
import { Photo } from '@/components/ui/photo';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useBooking, useCancelBooking } from '@/features/api/queries';
import { errorMessage } from '@/features/session/pending-signup';
import { haptic } from '@/lib/haptics';
import { formatTaka } from '@/lib/money';
import { dhakaInstant, formatDuration, formatRange, weekday, dayOfMonth } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function BookingTicket() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const insets = useSafeAreaInsets();
  const { data: b, isError, error, refetch } = useBooking(id);
  const justBooked = fresh === '1';
  const cancel = useCancelBooking();
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
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[6] }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <IconButton icon={X} label="Close" onPress={close} />
          <Wordmark height={26} />
          <IconButton icon={Share2} label="Share booking" onPress={share} />
        </View>

        {justBooked ? (
          <Animated.View entering={FadeInDown.duration(320)} style={styles.hello}>
            <Animated.View entering={ZoomIn.delay(120).springify()} style={styles.check}>
              <Check size={24} color={colors.ink} strokeWidth={3} />
            </Animated.View>
            <View style={styles.flex}>
              <Text variant="h1">You’re all set.</Text>
              <Text variant="label" color={colors.textMuted}>
                Your pitch. Your people. Game on.
              </Text>
            </View>
          </Animated.View>
        ) : (
          <Text variant="pageTitle" style={styles.hello}>
            Your ticket
          </Text>
        )}

        <Overline>{b?.status === 'cancelled' ? 'Booking cancelled' : b?.status === 'completed' ? 'Played' : 'Booking confirmed'}</Overline>

        {/* Ticket */}
        <Animated.View entering={FadeInDown.delay(80).duration(320)}>
          <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.lg} notch={13} style={styles.ticket}>
            {b ? <Photo source={b.venue.photo} style={styles.photo} /> : <Skeleton height={180} r={radius.md} />}
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
              {b ? (
                b.passToken ? (
                  <QRCode value={b.passToken} size={84} />
                ) : (
                  // Cancelled or played: the pass is no longer valid, so no QR is shown.
                  <View style={styles.noPass}>
                    <X size={28} color={colors.textOnDarkMuted} />
                  </View>
                )
              ) : (
                <Skeleton width={96} height={96} />
              )}
            </View>
          </TicketSurface>
        </Animated.View>

        {b ? (
          <View style={styles.paid}>
            <Check size={20} color={colors.ink} strokeWidth={2.6} />
            <Text variant="bodyStrong" style={styles.flex}>
              Paid {formatTaka(b.amountPaid)}
            </Text>
            <Text variant="label" color={colors.textMuted}>
              via {b.method}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label="Get directions" icon={Navigation} variant="light" onPress={directions} style={styles.flex} />
          <Button label="Download ticket" icon={Download} variant="light" onPress={share} style={styles.flex} />
        </View>

        <PressableScale
          scaleTo={0.99}
          onPress={() =>
            Alert.alert(
              'Before you arrive',
              'Arrive 15 minutes early, bring turf boots or flat trainers, and show your entry pass at reception.',
            )
          }>
          <Card style={styles.tip}>
            <Clock3 size={26} color={colors.ink} strokeWidth={1.7} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">Before you arrive</Text>
              <Text variant="label" color={colors.textMuted}>
                Arrive 15 minutes early. Bring your boots.
              </Text>
            </View>
            <ChevronRight size={20} color={colors.ink} />
          </Card>
        </PressableScale>

        <PressableScale
          scaleTo={0.99}
          onPress={() =>
            Alert.alert('Split the fee', 'Share this booking with your squad and track who has paid their share. Coming in the next build.')
          }>
          <Card tone="lime" style={styles.tip}>
            <AvatarStack names={['Rafi Ahmed', 'Sami Khan', 'Tanvir Islam']} size={38} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">Need more players?</Text>
              <Text variant="label" color={colors.text}>
                Invite your squad or split the fee
              </Text>
            </View>
            <View style={styles.darkArrow}>
              <ArrowRight size={18} color={colors.lime} strokeWidth={2.6} />
            </View>
          </Card>
        </PressableScale>

        <Button label="View my bookings" variant="dark" trailingIcon={ArrowRight} spread onPress={() => router.dismissTo('/bookings')} />
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, gap: space[4] },
  flex: { flex: 1 },
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
  pass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: colors.ink,
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
  passBadgeText: { fontFamily: 'Geist_800ExtraBold', letterSpacing: 1.6, color: colors.ink },
  code: { fontFamily: 'Geist_700Bold', fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  passRule: { width: 1, alignSelf: 'stretch', backgroundColor: colors.borderOnDark },
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
  darkArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  back: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  noPass: { width: 96, height: 96, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderOnDark, alignItems: 'center', justifyContent: 'center' },
  u: { textDecorationLine: 'underline' },
});
