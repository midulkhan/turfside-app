import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
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
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TicketDivider, TicketSurface } from '@/components/ticket/notch';
import { Avatar } from '@/components/ui/avatar';
import { Card, Divider } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/headers';
import { Photo } from '@/components/ui/photo';
import { Skeleton } from '@/components/ui/skeleton';
import { SlideToPay } from '@/components/ui/slide-to-pay';
import { ErrorState } from '@/components/ui/states';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import * as api from '@/features/api/client';
import { qk, useHold } from '@/features/api/queries';
import { ApiError } from '@/features/api/types';
import { useSession } from '@/features/session/session';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/ids';
import { formatTaka } from '@/lib/money';
import { formatDay, formatDuration, formatRange } from '@/lib/time';
import { colors, gutter, radius, space } from '@/theme/tokens';

const POLL_ATTEMPTS = 8;

function useCountdown(expiresAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, label: `${m}:${String(s).padStart(2, '0')}` };
}

export default function Checkout() {
  const { holdId } = useLocalSearchParams<{ holdId: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const hold = useHold(holdId);
  const { left, label } = useCountdown(hold.data?.expiresAt);
  const [paying, setPaying] = useState(false);
  // One idempotency key per hold: a retry after a network drop can never charge twice.
  const payKey = useRef(newIdempotencyKey());
  const paid = useRef(false);

  // Leaving without paying gives the slot back to everyone right away instead of
  // blocking it for the rest of the 10-minute hold. (A payment already in progress
  // with bKash is kept by the server; only a plain hold is released.)
  // The route-typed navigator doesn't list 'beforeRemove'; the stack does emit it.
  const navigation = useNavigation() as unknown as { addListener: (e: 'beforeRemove', cb: () => void) => () => void };
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        if (paid.current) return;
        const venueId = hold.data?.venue.id;
        api
          .releaseHold(holdId)
          .catch(() => {}) // offline: the hold simply expires on its own
          .finally(() => {
            qc.invalidateQueries({ queryKey: qk.myHolds });
            if (venueId) qc.invalidateQueries({ queryKey: ['slots', venueId] });
            qc.removeQueries({ queryKey: qk.hold(holdId) });
          });
      }),
    [navigation, holdId, hold.data?.venue.id, qc],
  );

  const expired = !!hold.data && left === 0;

  const pay = async () => {
    if (!hold.data || expired) return;
    setPaying(true);
    try {
      const returnUrl = Linking.createURL('payment-return');
      const { paymentId, checkoutUrl } = await api.startPayment(hold.data.holdId, payKey.current, returnUrl);
      let cancelled = false;
      if (checkoutUrl) {
        // bKash hosted checkout. The redirect back is NOT proof of payment —
        // we only trust the server's verification below.
        const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl);
        cancelled = result.type === 'success' && /[?&]status=cancel/.test(result.url);
      }
      for (let i = 0; i < (cancelled ? 1 : POLL_ATTEMPTS); i++) {
        const res = await api.getPaymentStatus(paymentId);
        if (res.status === 'confirmed' && res.bookingId) {
          paid.current = true;
          haptic.success();
          qc.invalidateQueries({ queryKey: qk.myHolds });
          qc.invalidateQueries({ queryKey: ['bookings'] });
          qc.invalidateQueries({ queryKey: ['notifications'] });
          qc.invalidateQueries({ queryKey: ['slots', hold.data.venue.id] });
          qc.removeQueries({ queryKey: ['hold', hold.data.holdId] });
          router.dismissTo({ pathname: '/booking/[id]', params: { id: res.bookingId, fresh: '1' } });
          return;
        }
        if (res.status === 'failed' || cancelled) {
          // That payment is closed for good, so a retry needs a fresh key.
          payKey.current = newIdempotencyKey();
          qc.invalidateQueries({ queryKey: ['hold', hold.data.holdId] });
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
      if (e instanceof ApiError && e.code === 'hold_expired') qc.invalidateQueries({ queryKey: ['hold', hold.data.holdId] });
    } finally {
      setPaying(false);
    }
  };

  const h = hold.data;
  const phoneMasked = user?.phone ? `+880 ${user.phone.slice(0, 4)}••••${user.phone.slice(-2)}` : '';

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader title="Checkout" />
        <View style={styles.stepper}>
          <Stepper steps={['Select slot', 'Review & pay', 'Confirmed']} current={1} />
        </View>
      </View>

      {hold.isError ? (
        <ErrorState message={hold.error.message} onRetry={() => router.back()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 170 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          {/* Hold timer */}
          {h ? (
            <View style={[styles.timer, expired && styles.timerExpired]}>
              <Timer size={18} color={expired ? colors.danger : colors.limeText} strokeWidth={2.2} />
              <Text variant="labelStrong" color={expired ? colors.danger : colors.limeText}>
                {expired ? 'Your hold expired — go back and pick the slot again' : `Slot held for you · ${label}`}
              </Text>
            </View>
          ) : null}

          {/* Booking summary ticket */}
          <TicketSurface fill={colors.surface} stroke={colors.border} radius={radius.lg} notch={12} style={styles.ticket}>
            {h ? <Photo source={h.venue.photo} style={styles.photo} /> : <Skeleton height={150} r={radius.md} />}
            {h ? (
              <View style={styles.formatBadge}>
                <UsersRound size={14} color={colors.textOnDark} />
                <Text variant="caption" color={colors.textOnDark}>
                  {h.venue.formats[0]}
                </Text>
              </View>
            ) : null}
            <View style={styles.ticketBody}>
              <Text variant="h2">{h?.venue.name ?? ' '}</Text>
              <View style={styles.row}>
                <MapPin size={16} color={colors.textMuted} />
                <Text variant="label" color={colors.textMuted}>
                  {h ? `${h.venue.area}, ${h.venue.city}` : ' '}
                </Text>
              </View>
            </View>
            <TicketDivider />
            <View style={styles.when}>
              <View style={styles.whenCol}>
                <CalendarDays size={22} color={colors.ink} strokeWidth={1.8} />
                <View style={styles.whenText}>
                  <Text variant="bodyStrong">{h ? formatDay(h.day, { year: false }) : ' '}</Text>
                  <Text variant="label" color={colors.textMuted}>
                    {h?.venue.formats[0]}
                  </Text>
                </View>
              </View>
              <View style={styles.vr} />
              <View style={styles.whenCol}>
                <Clock3 size={22} color={colors.ink} strokeWidth={1.8} />
                <View style={styles.whenText}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {h ? formatRange(h.start, h.end) : ' '}
                  </Text>
                  <Text variant="label" color={colors.textMuted}>
                    {h ? formatDuration(h.end - h.start) : ''}
                  </Text>
                </View>
              </View>
            </View>
          </TicketSurface>

          {/* Your details */}
          <Text variant="h3" style={styles.sectionTitle}>
            Your details
          </Text>
          <Card style={styles.details}>
            <Avatar name={user?.name ?? 'Player'} uri={user?.avatarUrl} size={52} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{user?.name}</Text>
              <Text variant="label" color={colors.textMuted}>
                {phoneMasked}
              </Text>
            </View>
            <View style={styles.vrTall} />
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.edit} hitSlop={8}>
              <Pencil size={18} color={colors.ink} strokeWidth={1.8} />
              <Text variant="labelStrong">Edit</Text>
            </Pressable>
          </Card>

          {/* Price details — all amounts come from the server quote */}
          <Text variant="h3" style={styles.sectionTitle}>
            Price details
          </Text>
          <Card padded={false}>
            <View style={styles.lines}>
              {h
                ? h.lines.map((l) => (
                    <View key={l.label} style={styles.line}>
                      <Text variant="body" color={colors.textMuted}>
                        {l.label}
                        {l.detail ? `  ·  ${l.detail}` : ''}
                      </Text>
                      <Text variant="bodyStrong">{formatTaka(l.amount)}</Text>
                    </View>
                  ))
                : [0, 1].map((i) => <Skeleton key={i} height={18} />)}
            </View>
            <Divider />
            <Pressable
              accessibilityRole="button"
              style={styles.promo}
              onPress={() => Alert.alert('Promo codes', 'Promo codes are coming soon.')}>
              <TicketPercent size={22} color={colors.ink} strokeWidth={1.7} />
              <Text variant="body" style={styles.flex}>
                Add promo code
              </Text>
              <Plus size={22} color={colors.ink} strokeWidth={1.8} />
            </Pressable>
            <View style={styles.total}>
              <Text variant="bodyStrong">Total payable</Text>
              <Text variant="h2" style={styles.totalAmount}>
                {h ? formatTaka(h.total) : '—'}
              </Text>
            </View>
          </Card>

          {/* Payment method */}
          <View style={styles.methodHead}>
            <Text variant="h3">Payment method</Text>
            <Text variant="label" color={colors.textMuted}>
              1 method
            </Text>
          </View>
          <View style={styles.method} accessibilityRole="radio" accessibilityState={{ selected: true }}>
            <Image
              source={require('@/assets/brand/bkash.png')}
              style={styles.bkashLogo}
              contentFit="contain"
              accessibilityLabel="bKash"
              cachePolicy="memory-disk"
            />
            <View style={styles.vrPink} />
            <Text variant="body" color={colors.textMuted} style={styles.flex}>
              Mobile wallet
            </Text>
            <View style={styles.radioOn}>
              <Check size={16} color={colors.textOnDark} strokeWidth={3} />
            </View>
          </View>
          <View style={styles.row}>
            <Lock size={15} color={colors.textMuted} />
            <Text variant="label" color={colors.textMuted}>
              You’ll continue to bKash to pay. We never see your PIN.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => h && Alert.alert('Cancellation policy', h.cancellationPolicy)}
            style={styles.policy}>
            <FileText size={22} color={colors.ink} strokeWidth={1.7} />
            <Text variant="bodyStrong" style={styles.flex}>
              Cancellation policy
            </Text>
            <ChevronRight size={20} color={colors.ink} />
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
          label={h ? `Slide to pay ${formatTaka(h.total)}` : 'Slide to pay'}
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

const styles = StyleSheet.create({
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
  edit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: space[1], minHeight: 44 },
  lines: { padding: space[4], gap: space[3] },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  promo: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], minHeight: 56 },
  totalAmount: { fontFamily: 'Geist_800ExtraBold', fontSize: 22, lineHeight: 28 },
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
  bkashLogo: { width: 92, height: 42 },
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
});
