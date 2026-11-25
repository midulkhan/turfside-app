import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Lock,
  MapPin,
  Pencil,
  Plus,
  TicketPercent,
  Timer,
  UsersRound,
  X,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/components/ui/dialog';
import { TicketDivider, TicketSurface } from '@/components/ticket/notch';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { StickyHeader, useScrolled } from '@/components/ui/sticky-header';
import { Photo } from '@/components/ui/photo';
import { Skeleton } from '@/components/ui/skeleton';
import { SlideToPay } from '@/components/ui/slide-to-pay';
import { ErrorState } from '@/components/ui/states';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { markSlots, qk, useHold, useMatch } from '@/features/api/queries';
import { ApiError, type QuoteLine } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/ids';
import { formatTaka } from '@/lib/money';
import { formatDay, formatRange } from '@/lib/time';
import { colors, getScheme, gutter, radius, space } from '@/theme/tokens';
import { createStyles } from '@/theme/styles';

const POLL_ATTEMPTS = 8;

/** One of the two ways to pay: a radio card with the amount on the right. */
function PayOption({ title, amount, caption, selected, onPress }: { title: string; amount: string; caption: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${amount}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => [styles.mode, selected && styles.modeOn, pressed && styles.modePressed]}>
      <View style={[styles.radio, selected && styles.radioSel]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <View style={styles.flex}>
        <View style={styles.modeHead}>
          <Text variant="labelStrong" style={styles.flex} numberOfLines={2}>
            {title}
          </Text>
          <Text variant="labelStrong">{amount}</Text>
        </View>
        <Text variant="label" color={colors.textMuted}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

function useCountdown(expiresAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return { left, label: `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}` };
}

/** What checkout shows, from a cart hold or from your share of a match. */
type Summary = {
  photo: string | null;
  name: string;
  place: string;
  format: string;
  slots: { id: string; day: string; start: number; end: number }[];
  lines: QuoteLine[];
  total: number;
  expiresAt: number;
  policy: string;
};

/**
 * Checkout. Two kinds of payment, one screen:
 *  - `?holdId=` a cart of held slots (the booking flow)
 *  - `?match=`  your share of a match you were accepted into (find players)
 */
export default function Checkout() {
  const { holdId, match: matchId } = useLocalSearchParams<{ holdId?: string; match?: string }>();
  const isShare = !!matchId;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const hold = useHold(isShare ? undefined : holdId);
  const match = useMatch(matchId);
  const mt = match.data;
  const h: Summary | undefined = isShare
    ? mt && mt.my === 'accepted' && mt.payBy
      ? {
          photo: mt.venue.photo,
          name: mt.venue.name,
          place: mt.venue.area,
          format: mt.format,
          slots: [{ id: '', day: mt.day, start: mt.start, end: mt.end }],
          lines: [
            mt.type === 'opponent'
              ? { label: 'Your share', detail: `${mt.title} · your team's ${mt.opponentPercent ?? 50}% of the turf`, amount: mt.share }
              : {
                  label: 'Your share',
                  detail: (mt.mySpots ?? 1) === 1 ? `${mt.title} · 1 of ${mt.playersTotal} players` : `${mt.title} · ${mt.mySpots} spots × ${formatTaka(mt.share)}`,
                  amount: mt.share * (mt.mySpots ?? 1),
                },
          ],
          total: mt.type === 'opponent' ? mt.share : mt.share * (mt.mySpots ?? 1),
          expiresAt: mt.payBy,
          policy:
            mt.type === 'opponent'
              ? "Paying locks in the game for your team. If the host cancels, you get a full refund. Can't make it? Let the host know — paid shares aren't refunded otherwise."
              : "Your share secures your place in the squad. If the organiser cancels the game, you get a full refund. Can't make it? Let the organiser know — paid shares aren't refunded otherwise.",
        }
      : undefined
    : hold.data
      ? {
          photo: hold.data.venue.photo,
          name: hold.data.venue.name,
          place: `${hold.data.venue.area}, ${hold.data.venue.city}`,
          format: hold.data.venue.formats[0],
          slots: hold.data.slots ?? [{ id: '', day: hold.data.day, start: hold.data.start, end: hold.data.end }],
          lines: hold.data.lines,
          total: hold.data.total,
          expiresAt: hold.data.expiresAt,
          policy: hold.data.cancellationPolicy,
        }
      : undefined;
  // A share that is no longer payable (paid, expired, withdrawn…) has nothing to check out.
  const shareGone = isShare && !!mt && !(mt.my === 'accepted' && mt.payBy);
  const loadError = isShare
    ? match.isError
      ? match.error
      : shareGone
        ? new Error(mt?.my === 'paid' ? "You've already paid. You're in the squad." : 'This spot is no longer reserved for you.')
        : null
    : hold.isError
      ? hold.error
      : null;
  const { left, label } = useCountdown(h?.expiresAt);
  const [paying, setPaying] = useState(false);
  // One idempotency key per hold: a retry after a network drop can never charge twice.
  const payKey = useRef(newIdempotencyKey());
  // Full payment, or partial: 500 tk per slot now and the rest at the turf (when the turf costs more).
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const part = !isShare && hold.data?.partial?.available ? hold.data.partial : null;
  const partial = mode === 'partial' && !!part;
  const payNow = h ? (partial ? part!.now : h.total) : 0;
  const pickMode = (next: 'full' | 'partial') => {
    if (next === mode || paying) return;
    haptic.select();
    setMode(next);
    payKey.current = newIdempotencyKey(); // a different amount is a different payment
  };
  const paid = useRef(false);

  // No cart: leaving checkout without paying gives the slots straight back, so they're free
  // for everyone again (the turf page keeps them selected for you). A payment that's under
  // way keeps its hold on the server.
  const heldId = useRef<string | null>(null);
  const heldVenue = useRef<string | null>(null);
  const heldSlots = useRef<string[]>([]);
  useEffect(() => {
    heldId.current = hold.data?.holdId ?? null;
    heldVenue.current = hold.data?.venue.id ?? null;
    heldSlots.current = hold.data?.slots?.map((x) => x.id) ?? [];
  }, [hold.data?.holdId, hold.data?.venue.id, hold.data?.slots]);
  useEffect(
    () => () => {
      const id = heldId.current;
      if (isShare || !id || paid.current) return;
      const venue = heldVenue.current;
      qc.removeQueries({ queryKey: qk.hold(id) });
      api
        .releaseHold(id)
        .catch(() => {})
        .then(() => venue && markSlots(qc, venue, heldSlots.current, 'available'))
        .finally(() => {
          qc.invalidateQueries({ queryKey: qk.myHolds });
          qc.invalidateQueries({ queryKey: venue ? ['slots', venue] : ['slots'] });
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const removeSlot = async (slotId: string) => {
    if (!hold.data || removing || paying) return;
    haptic.select();
    setRemoving(slotId);
    try {
      const res = await api.removeHoldSlot(hold.data.holdId, slotId);
      markSlots(qc, hold.data.venue.id, [slotId], 'available');
      qc.invalidateQueries({ queryKey: ['slots', hold.data.venue.id] }); // others see it free via realtime; this refreshes us
      qc.invalidateQueries({ queryKey: qk.myHolds });
      if (res.released || !res.hold) {
        qc.removeQueries({ queryKey: qk.hold(hold.data.holdId) });
        router.back(); // cart is empty: back to the turf
        return;
      }
      qc.setQueryData(qk.hold(res.hold.holdId), res.hold);
    } catch (e) {
      haptic.error();
      Alert.alert('Could not remove that slot', e instanceof Error ? e.message : 'Please try again.');
      if (e instanceof ApiError && e.code === 'hold_expired') qc.invalidateQueries({ queryKey: qk.hold(hold.data.holdId) });
    } finally {
      setRemoving(null);
    }
  };

  const expired = !!h && left === 0;

  const pay = async () => {
    if (!h || expired) return;
    setPaying(true);
    try {
      const returnUrl = Linking.createURL('payment-return');
      const { paymentId, checkoutUrl } = isShare
        ? await api.startSharePayment(matchId!, payKey.current, returnUrl)
        : await api.startPayment(hold.data!.holdId, payKey.current, returnUrl, undefined, partial ? 'partial' : 'full');
      let cancelled = false;
      if (checkoutUrl) {
        // bKash hosted checkout. The redirect back is NOT proof of payment —
        // we only trust the server's verification below.
        const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl);
        cancelled = result.type === 'success' && /[?&]status=cancel/.test(result.url);
      }
      for (let i = 0; i < (cancelled ? 1 : POLL_ATTEMPTS); i++) {
        const res = await api.getPaymentStatus(paymentId);
        if (res.status === 'confirmed' && res.kind === 'share') {
          paid.current = true;
          haptic.success();
          qc.invalidateQueries({ queryKey: ['matches'] });
          qc.invalidateQueries({ queryKey: qk.match(matchId!) });
          qc.invalidateQueries({ queryKey: ['notifications'] });
          router.dismissTo('/join');
          Alert.alert("You're in the squad", `See you at ${h.name}, ${formatDay(h.slots[0].day, { year: false })}.`);
          return;
        }
        if (res.status === 'confirmed' && res.bookingId && hold.data) {
          paid.current = true;
          haptic.success();
          qc.invalidateQueries({ queryKey: qk.myHolds });
          qc.invalidateQueries({ queryKey: ['bookings'] });
          qc.invalidateQueries({ queryKey: ['notifications'] });
          // Booked on the turf page straight away (the refetch confirms it).
          markSlots(qc, hold.data.venue.id, (hold.data.slots ?? []).map((x) => x.id), 'booked');
          qc.invalidateQueries({ queryKey: ['slots', hold.data.venue.id] });
          qc.removeQueries({ queryKey: ['hold', hold.data.holdId] });
          router.dismissTo({ pathname: '/booking/[id]', params: { id: res.bookingId, fresh: '1' } });
          return;
        }
        if (res.status === 'failed' || cancelled) {
          // That payment is closed for good, so a retry needs a fresh key.
          payKey.current = newIdempotencyKey();
          if (hold.data) qc.invalidateQueries({ queryKey: ['hold', hold.data.holdId] });
          throw new Error(
            cancelled
              ? 'You cancelled the bKash payment. Nothing was charged.'
              : 'bKash could not complete the payment. You have not been charged.',
          );
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 1.5 ** i, 4000)));
      }
      throw new Error('We are still confirming your payment with bKash. Check My bookings in a minute — you will not be charged twice.');
    } catch (e) {
      haptic.error();
      const title = e instanceof ApiError && e.code === 'not_configured' ? 'Payments are not live yet' : 'Payment not completed';
      Alert.alert(title, e instanceof Error ? e.message : 'Please try again.');
      if (e instanceof ApiError && e.code === 'hold_expired') {
        if (hold.data) qc.invalidateQueries({ queryKey: ['hold', hold.data.holdId] });
        if (isShare) qc.invalidateQueries({ queryKey: qk.match(matchId!) });
      }
    } finally {
      setPaying(false);
    }
  };

  const scrolled = useScrolled();
  const phoneMasked = user?.phone ? `+880 ${user.phone.slice(0, 4)}••••${user.phone.slice(-2)}` : '';

  return (
    <View style={styles.root}>
      <StickyHeader progress={scrolled.progress}>
        <ScreenHeader title="Checkout" />
        <View style={styles.stepper}>
          <Stepper
            steps={isShare ? ['Accepted', 'Pay your share', 'In the squad'] : ['Select slot', 'Review & pay', 'Confirmed']}
            current={1}
          />
        </View>
      </StickyHeader>

      {loadError ? (
        <ErrorState message={loadError.message} onRetry={() => router.back()} />
      ) : (
        <ScrollView
          onScroll={scrolled.onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.content, { paddingBottom: 170 + insets.bottom }]}
          showsVerticalScrollIndicator={false}>
          {/* Hold timer */}
          {h ? (
            <View style={[styles.timer, expired && styles.timerExpired]}>
              <Timer size={16} color={expired ? colors.danger : colors.limeText} strokeWidth={2} />
              <Text variant="label" color={expired ? colors.danger : colors.limeText}>
                {expired
                  ? isShare
                    ? 'Your reserved spot has expired'
                    : 'Your hold expired — go back and pick again'
                  : isShare
                    ? `Spot reserved for you · ${label}`
                    : `${h.slots.length > 1 ? `${h.slots.length} slots held` : 'Slot held'} for you · ${label}`}
              </Text>
            </View>
          ) : null}

          {/* Booking summary ticket */}
          <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.lg} notch={12} style={styles.ticket}>
            {h ? <Photo source={h.photo} style={styles.photo} /> : <Skeleton height={150} r={radius.md} />}
            {h ? (
              <View style={styles.formatBadge}>
                <UsersRound size={14} color={colors.textOnDark} />
                <Text variant="caption" color={colors.textOnDark}>
                  {h.format}
                </Text>
              </View>
            ) : null}
            <View style={styles.ticketBody}>
              <Text variant="title" style={styles.venueName}>
                {h?.name ?? ' '}
              </Text>
              <View style={styles.row}>
                <MapPin size={14} color={colors.textMuted} strokeWidth={1.7} />
                <Text variant="body" color={colors.textMuted} style={styles.small}>
                  {h ? h.place : ' '}
                </Text>
              </View>
            </View>
            <TicketDivider />
            {h ? (
              <View style={styles.slotList}>
                {h.slots.map((sl, i) => (
                  <View key={sl.id || i} style={[styles.slotRow, i > 0 && styles.slotRowDivider]}>
                    <CalendarDays size={16} color={colors.textMuted} strokeWidth={1.6} />
                    <Text variant="labelStrong" style={[styles.whenMain, styles.flex]} numberOfLines={1}>
                      {formatDay(sl.day, { year: false })}
                    </Text>
                    <Clock3 size={16} color={colors.textMuted} strokeWidth={1.6} />
                    <Text variant="labelStrong" style={styles.whenMain} numberOfLines={1}>
                      {formatRange(sl.start, sl.end)}
                    </Text>
                    {sl.id ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${formatDay(sl.day, { year: false })}, ${formatRange(sl.start, sl.end)}`}
                        disabled={!!removing || paying || expired}
                        onPress={() => removeSlot(sl.id)}
                        hitSlop={10}
                        style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}>
                        {removing === sl.id ? (
                          <ActivityIndicator size="small" color={colors.textMuted} />
                        ) : (
                          <X size={14} color={colors.ink} strokeWidth={2.2} />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.slotList}>
                <Skeleton height={20} />
              </View>
            )}
          </TicketSurface>

          {/* Your details */}
          <Text variant="title" style={[styles.section, styles.sectionTitle]}>
            Your details
          </Text>
          <Card style={styles.details}>
            <Avatar name={user?.name ?? 'Player'} uri={user?.avatarUrl} size={44} />
            <View style={styles.flex}>
              <Text variant="labelStrong" style={styles.whenMain}>
                {user?.name}
              </Text>
              <Text variant="body" color={colors.textMuted} style={styles.small}>
                {phoneMasked}
              </Text>
            </View>
            <View style={styles.vrTall} />
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.edit} hitSlop={8}>
              <Pencil size={15} color={colors.ink} strokeWidth={1.7} />
              <Text variant="label">Edit</Text>
            </Pressable>
          </Card>

          {/* How to pay: everything now, or 500 tk per slot now and the rest at the turf */}
          {part && h ? (
            <>
              <Text variant="title" style={[styles.section, styles.sectionTitle]}>
                How do you want to pay?
              </Text>
              <View style={styles.modes} accessibilityRole="radiogroup">
                <PayOption
                  title="Full payment"
                  amount={formatTaka(h.total)}
                  caption="Pay everything now. Nothing to pay at the turf."
                  selected={mode === 'full'}
                  onPress={() => pickMode('full')}
                />
                <PayOption
                  title={h.slots.length > 1 ? `Partial payment · ${formatTaka(part.perSlot)} per slot` : 'Partial payment'}
                  amount={formatTaka(part.now)}
                  caption={`Pay ${formatTaka(part.now)} now to book. Pay the remaining ${formatTaka(part.atTurf)} at the turf.`}
                  selected={mode === 'partial'}
                  onPress={() => pickMode('partial')}
                />
              </View>
            </>
          ) : null}

          {/* Price details — all amounts come from the server quote */}
          <Text variant="title" style={[styles.section, styles.sectionTitle]}>
            Price details
          </Text>
          <Card padded={false}>
            <View style={styles.lines}>
              {h
                ? h.lines.filter((l) => !(l.label === 'Service fee' && l.amount === 0)).map((l, i) => (
                    <View key={`${i}:${l.label}`} style={styles.line}>
                      {/* Label wraps in its own column; the amount keeps its width on the right. */}
                      <View style={styles.lineLabel}>
                        <Text variant="body" color={colors.textMuted} style={styles.lineText}>
                          {l.label === 'Turf booking' && l.detail ? l.detail : l.label}
                        </Text>
                        {l.label === 'Your share' && l.detail ? (
                          <Text variant="label" color={colors.textSubtle}>
                            {l.detail}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="labelStrong" style={[styles.lineText, styles.lineAmount]}>
                        {formatTaka(l.amount)}
                      </Text>
                    </View>
                  ))
                : [0, 1].map((i) => <Skeleton key={i} height={18} />)}
              {/* Partial payment: the whole price, and what's left for the turf. */}
              {partial && h ? (
                <View style={styles.split}>
                  <View style={styles.line}>
                    <Text variant="body" color={colors.textMuted} style={[styles.flex, styles.lineText]}>
                      Booking total
                    </Text>
                    <Text variant="labelStrong" style={[styles.lineText, styles.lineAmount]}>
                      {formatTaka(h.total)}
                    </Text>
                  </View>
                  <View style={styles.line}>
                    <Text variant="body" color={colors.textMuted} style={[styles.flex, styles.lineText]}>
                      Pay at the turf
                    </Text>
                    <Text variant="labelStrong" style={[styles.lineText, styles.lineAmount]}>
                      {formatTaka(part!.atTurf)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
            <Divider />
            {isShare ? null : (
              <Pressable
                accessibilityRole="button"
                style={styles.promo}
                onPress={() => Alert.alert('Promo codes', 'Promo codes are coming soon.')}>
                <TicketPercent size={18} color={colors.ink} strokeWidth={1.6} />
                <Text variant="body" style={[styles.flex, styles.lineText]}>
                  Add promo code
                </Text>
                <Plus size={18} color={colors.ink} strokeWidth={1.7} />
              </Pressable>
            )}
            <View style={styles.total}>
              <Text variant="labelStrong" style={styles.whenMain}>
                {partial ? 'Pay now' : 'Total payable'}
              </Text>
              <Text variant="h2" style={styles.totalAmount}>
                {h ? formatTaka(payNow) : '—'}
              </Text>
            </View>
          </Card>

          {/* Payment method */}
          <View style={styles.methodHead}>
            <Text variant="title" style={styles.section}>
              Payment method
            </Text>
            <Text variant="label" color={colors.textMuted}>
              1 method
            </Text>
          </View>
          <View style={styles.method} accessibilityRole="radio" accessibilityState={{ selected: true }}>
            <Image
              source={require('@/assets/brand/bkash.png')}
              // bKash's dark-pink wordmark needs a light plate on the dark theme.
              style={[styles.bkashLogo, getScheme() === 'dark' && styles.logoPlate]}
              contentFit="contain"
              accessibilityLabel="bKash"
              cachePolicy="memory-disk"
            />
            <View style={styles.vrPink} />
            <Text variant="body" color={colors.textMuted} style={[styles.flex, styles.lineText]}>
              Mobile wallet
            </Text>
            <View style={styles.radioOn}>
              <Check size={16} color={colors.textOnDark} strokeWidth={3} />
            </View>
          </View>
          <View style={styles.row}>
            <Lock size={13} color={colors.textMuted} />
            <Text variant="caption" color={colors.textMuted}>
              You’ll continue to bKash to pay. We never see your PIN.
            </Text>
          </View>

          <Pressable accessibilityRole="button" onPress={() => h && Alert.alert('Cancellation policy', h.policy)} style={styles.policy}>
            <FileText size={18} color={colors.ink} strokeWidth={1.6} />
            <Text variant="label" style={styles.flex}>
              Cancellation policy
            </Text>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>
        </ScrollView>
      )}

      {/* Pay bar */}
      <View style={[styles.payBar, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <Text variant="caption" color={colors.textMuted} align="center">
          By continuing, you agree to the{' '}
          <Text variant="caption" style={styles.u}>
            booking terms
          </Text>
          .
        </Text>
        <SlideToPay
          label={h ? `Slide to pay ${formatTaka(payNow)}` : 'Slide to pay'}
          onComplete={pay}
          busy={paying}
          disabled={!h || expired}
        />
        <View style={[styles.row, styles.center]}>
          <Lock size={13} color={colors.textMuted} />
          <Text variant="caption" color={colors.textMuted}>
            Payment processed by bKash
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  center: { justifyContent: 'center' },
  stepper: { paddingHorizontal: gutter, paddingBottom: space[3] },
  content: { paddingHorizontal: gutter, gap: space[3] },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.limeSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    height: 40,
    alignSelf: 'flex-start',
  },
  timerExpired: { backgroundColor: colors.dangerSoft },
  ticket: { padding: 6 },
  photo: { height: 150 },
  formatBadge: {
    position: 'absolute',
    left: space[4],
    top: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(22,27,29,0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    height: 28,
  },
  ticketBody: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2], gap: 2 },
  when: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[3] },
  whenCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  whenText: { flex: 1 },
  vr: { width: 1, height: 40, backgroundColor: colors.border, marginHorizontal: space[2] },
  vrTall: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  sectionTitle: { marginTop: space[3] },
  details: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  modes: { gap: space[3] },
  mode: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeOn: { borderColor: colors.ink },
  modePressed: { opacity: 0.85 },
  modeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], marginBottom: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textSubtle, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioSel: { borderColor: colors.ink },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.ink },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: space[1], minHeight: 44 },
  lines: { padding: space[4], gap: space[3] },
  split: { gap: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[4] },
  lineLabel: { flex: 1, minWidth: 0, gap: 2 },
  lineAmount: { flexShrink: 0, textAlign: 'right' },
  promo: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], minHeight: 56 },
  totalAmount: { fontFamily: 'Geist_700Bold', fontSize: 19, lineHeight: 24 },
  venueName: { fontSize: 18, lineHeight: 23, letterSpacing: -0.2 },
  section: { fontSize: 16, lineHeight: 21 },
  whenMain: { fontSize: 14.5, lineHeight: 19 },
  small: { fontSize: 13, lineHeight: 17 },
  slotList: { paddingHorizontal: space[5], paddingVertical: space[3] },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[3] },
  remove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginLeft: space[1],
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { opacity: 0.6 },
  slotRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineText: { fontSize: 14, lineHeight: 19 },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.limeSoft,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  methodHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space[3] },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderWidth: 1.5,
    borderColor: colors.bkash,
    backgroundColor: colors.bkashSoft,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    height: 72,
  },
  bkashLogo: { width: 70, height: 32 },
  logoPlate: { backgroundColor: '#FFFFFF', borderRadius: radius.xs, width: 82, paddingHorizontal: 6 },
  vrPink: { width: 1, height: 30, backgroundColor: '#F5B5CF' },
  radioOn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bkash, alignItems: 'center', justifyContent: 'center' },
  policy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    height: 60,
    marginTop: space[2],
  },
  payBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: gutter,
    paddingTop: space[3],
    gap: space[2],
  },
  u: { textDecorationLine: 'underline' },
}));
