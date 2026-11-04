/**
 * API client.
 *
 * Today this is an in-memory mock so the UI can be built and tested without a
 * backend. Every function has the same signature the real HTTP client will
 * have, so swapping it later only touches this file.
 *
 * Security contract (the real server must enforce all of this; the mock mirrors it):
 *  - Prices, fees and totals are computed by the server. The app sends ids only.
 *  - A booking is confirmed only after the server verifies the bKash payment.
 *    Redirects, deep links, screenshots or typed transaction IDs never confirm one.
 *  - Booking/payment requests carry an idempotency key, so retries are harmless.
 *  - Auth tokens live in SecureStore (Keychain/Keystore), never AsyncStorage.
 */
import { taka } from '@/lib/money';
import { generateSessions, hourlyFor, sessionPrice } from '@/lib/schedule';
import { addDays, dayOfWeekIndex, dhakaToday, formatClock, type DayKey } from '@/lib/time';

import { hash, haversineKm, venues, type DbVenue } from './mock-db';
import {
  ApiError,
  type Booking,
  type DaySlots,
  type ExploreParams,
  type ExploreResult,
  type Hold,
  type NotificationItem,
  type PlayerRequest,
  type ReviewSummary,
  type Slot,
  type VenueDetail,
  type VenueSummary,
} from './types';

const HOLD_MINUTES = 10;
const RADIUS_STEPS_KM = [5, 10, 20, 30]; // server config table in production
const MIN_RESULTS = 5;

// ---- mock state -------------------------------------------------------------
const saved = new Set<string>(['v_gulshan_goal']);
const bookedByUs = new Set<string>(); // slot ids booked in this session
const holds = new Map<string, Hold & { slotId: string }>();
const payments = new Map<string, { holdId: string; key: string }>();
const bookings: Booking[] = [];
const idempotency = new Map<string, unknown>();

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
const latency = () => 220 + Math.random() * 180;

function findVenue(id: string) {
  const v = venues.find((x) => x.id === id);
  if (!v) throw new ApiError('not_found', 'This turf is no longer listed.');
  return v;
}

function slotsFor(v: DbVenue, day: DayKey): Slot[] {
  const hourly = hourlyFor(v.prices, day, dayOfWeekIndex(day));
  const isToday = day === dhakaToday();
  const nowMin = Math.floor((Date.now() / 60000 + 360) % 1440); // minutes after Dhaka midnight
  return (
    generateSessions(v.session)
      // Sessions that already started today are not offered at all (no greyed-out clutter).
      .filter(({ start }) => !isToday || start > nowMin)
      .map(({ start, end }) => {
        const id = `${v.id}:${day}:${start}`;
        const r = hash(id);
        let status: Slot['status'] = r < 0.3 ? 'booked' : r < 0.36 ? 'blocked' : 'available';
        if (bookedByUs.has(id)) status = 'booked';
        return { id, start, end, status, price: sessionPrice(hourly, v.session.lengthMin) };
      })
  );
}

function toSummary(v: DbVenue, lat?: number, lng?: number): VenueSummary {
  const today = dhakaToday();
  const hourly = hourlyFor(v.prices, today, dayOfWeekIndex(today));
  return {
    id: v.id,
    name: v.name,
    area: v.area,
    city: v.city,
    distanceKm: lat == null || lng == null ? null : Math.round(haversineKm(lat, lng, v.lat, v.lng) * 10) / 10,
    rating: v.rating,
    reviewCount: v.reviewCount,
    formats: v.formats,
    floodlit: v.floodlit,
    hourlyFrom: hourly,
    availableToday: slotsFor(v, today).some((s) => s.status === 'available'),
    photo: v.photos[0] ?? null,
    isSaved: saved.has(v.id),
  };
}

// ---- venues -----------------------------------------------------------------
export async function explore(p: ExploreParams, signal?: AbortSignal): Promise<ExploreResult> {
  await wait(latency(), signal);
  const q = p.query?.trim().toLowerCase();
  const all = venues
    .filter((v) => (p.format === 'any' ? true : v.formats.includes(p.format)))
    .filter((v) => (p.floodlitOnly ? v.floodlit : true))
    .filter((v) => (q ? `${v.name} ${v.area}`.toLowerCase().includes(q) : true))
    .map((v) => toSummary(v, p.lat, p.lng))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || b.rating - a.rating);

  // Adaptive radius: widen 5 → 10 → 20 → 30 km until ~5 turfs are found.
  let radiusKm = RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1];
  for (const r of RADIUS_STEPS_KM) {
    if (all.filter((v) => (v.distanceKm ?? 0) <= r).length >= MIN_RESULTS) {
      radiusKm = r;
      break;
    }
  }
  const inRange = all.filter((v) => (v.distanceKm ?? 0) <= radiusKm);
  return {
    radiusKm,
    near: inRange.filter((v) => (v.distanceKm ?? 0) <= RADIUS_STEPS_KM[0]),
    further: inRange.filter((v) => (v.distanceKm ?? 0) > RADIUS_STEPS_KM[0]),
  };
}

export async function getVenue(id: string, signal?: AbortSignal): Promise<VenueDetail> {
  await wait(latency(), signal);
  const v = findVenue(id);
  return {
    ...toSummary(v),
    address: v.address,
    shortAddress: `${v.address.split(',')[0].trim()}, ${v.area}`,
    openingHours: `Daily, ${formatClock(v.session.openMin)} – ${formatClock(v.session.closeMin)}`,
    latitude: v.lat,
    longitude: v.lng,
    photos: v.photos,
    amenities: v.amenities,
    rules: ['Arrive 15 minutes early', 'Turf boots or flat trainers only', 'No smoking on the pitch'],
    about: `${v.formats.join(' / ')} pitch in ${v.area}${v.floodlit ? ' with floodlights for night games' : ''}.`,
    sessionLengthMin: v.session.lengthMin,
    cancellationPolicy: 'Free cancellation up to 24 hours before kick-off. After that, the booking fee is non-refundable.',
  };
}

export async function getSlots(venueId: string, day: DayKey, signal?: AbortSignal): Promise<DaySlots> {
  await wait(latency() * 0.7, signal);
  return { venueId, day, slots: slotsFor(findVenue(venueId), day), fetchedAt: Date.now() };
}

export async function getSaved(signal?: AbortSignal): Promise<VenueSummary[]> {
  await wait(latency(), signal);
  return venues.filter((v) => saved.has(v.id)).map((v) => toSummary(v));
}

export async function setSaved(venueId: string, value: boolean) {
  await wait(160);
  if (value) saved.add(venueId);
  else saved.delete(venueId);
  return { venueId, isSaved: value };
}

// ---- checkout ---------------------------------------------------------------
/** Reserve a slot for HOLD_MINUTES. The server re-checks availability atomically. */
export async function createHold(slotId: string, idempotencyKey: string): Promise<Hold> {
  if (idempotency.has(idempotencyKey)) return idempotency.get(idempotencyKey) as Hold;
  await wait(latency());
  const [venueId, day, startStr] = slotId.split(':');
  const v = findVenue(venueId);
  const slot = slotsFor(v, day).find((s) => s.start === Number(startStr));
  if (!slot || slot.status !== 'available') throw new ApiError('slot_taken', 'Slot just got taken. Pick another time.');
  const serviceFee = taka(0);
  const hold: Hold & { slotId: string } = {
    slotId,
    holdId: `hold_${Math.random().toString(36).slice(2, 10)}`,
    expiresAt: Date.now() + HOLD_MINUTES * 60_000,
    venue: { id: v.id, name: v.name, area: v.area, city: v.city, photo: v.photos[0] ?? null, formats: v.formats },
    day,
    start: slot.start,
    end: slot.end,
    lines: [
      { label: 'Turf booking', detail: v.session.lengthMin === 60 ? '1 hour' : `${v.session.lengthMin} min`, amount: slot.price },
      { label: 'Service fee', amount: serviceFee },
    ],
    total: slot.price + serviceFee,
    cancellationPolicy: 'Free cancellation up to 24 hours before kick-off.',
  };
  holds.set(hold.holdId, hold);
  idempotency.set(idempotencyKey, hold);
  return hold;
}

export async function getHold(holdId: string): Promise<Hold> {
  await wait(latency());
  const h = holds.get(holdId);
  if (!h) throw new ApiError('not_found', 'Your hold was not found. Please pick the slot again.');
  return h;
}

/**
 * Start a bKash payment for a hold.
 * Production: the server calls bKash "create payment" and returns its checkout URL;
 * the app opens it with WebBrowser.openAuthSessionAsync and then polls
 * `getPaymentStatus` — the server confirms only after bKash "execute/query" succeeds.
 */
export async function startPayment(holdId: string, idempotencyKey: string) {
  await wait(latency());
  const hold = holds.get(holdId);
  if (!hold) throw new ApiError('not_found', 'Your hold was not found. Please pick the slot again.');
  if (hold.expiresAt < Date.now()) throw new ApiError('hold_expired', 'Your 10-minute hold expired. Please pick the slot again.');
  const existing = [...payments.entries()].find(([, p]) => p.key === idempotencyKey);
  const paymentId = existing?.[0] ?? `pay_${Math.random().toString(36).slice(2, 10)}`;
  payments.set(paymentId, { holdId, key: idempotencyKey });
  return { paymentId, checkoutUrl: null as string | null }; // mock: no external page
}

/** Poll until the server has verified the payment with bKash. Idempotent. */
export async function getPaymentStatus(paymentId: string): Promise<{ status: 'pending' | 'confirmed' | 'failed'; bookingId?: string }> {
  await wait(900);
  const p = payments.get(paymentId);
  if (!p) return { status: 'failed' };
  const done = bookings.find((b) => b.id === `bk_${paymentId}`);
  if (done) return { status: 'confirmed', bookingId: done.id };
  const hold = holds.get(p.holdId);
  if (!hold) return { status: 'failed' };
  const v = findVenue(hold.venue.id);
  bookedByUs.add(hold.slotId);
  const d = hold.day.replaceAll('-', '').slice(2);
  const booking: Booking = {
    id: `bk_${paymentId}`,
    code: `TS-${d}-${String(Math.floor(hash(paymentId) * 9000) + 1000)}`,
    venue: { ...hold.venue, latitude: v.lat, longitude: v.lng },
    day: hold.day,
    start: hold.start,
    end: hold.end,
    amountPaid: hold.total,
    method: 'bKash',
    status: 'confirmed',
    passToken: `tsp1.${paymentId}.${Math.random().toString(36).slice(2)}`, // signed JWT-like token from server
  };
  bookings.unshift(booking);
  holds.delete(p.holdId);
  return { status: 'confirmed', bookingId: booking.id };
}

// ---- bookings -------------------------------------------------------------
function seedBookings() {
  if (bookings.length) return;
  const today = dhakaToday();
  const mk = (venueId: string, day: DayKey, start: number, len: number, status: Booking['status'], n: string): Booking => {
    const v = findVenue(venueId);
    const price = sessionPrice(hourlyFor(v.prices, day, dayOfWeekIndex(day)), len);
    return {
      id: `bk_seed_${n}`,
      code: `TS-${day.replaceAll('-', '').slice(2)}-0${n}42`,
      venue: {
        id: v.id,
        name: v.name,
        area: v.area,
        city: v.city,
        photo: v.photos[0] ?? null,
        formats: v.formats,
        latitude: v.lat,
        longitude: v.lng,
      },
      day,
      start,
      end: start + len,
      amountPaid: price,
      method: 'bKash',
      status,
      passToken: `tsp1.seed${n}`,
    };
  };
  bookings.push(
    mk('v_bashundhara', addDays(today, 2), 19 * 60, 60, 'confirmed', '8'),
    mk('v_kickoff_uttara', addDays(today, 6), 17 * 60 + 30, 90, 'confirmed', '7'),
    mk('v_mirpur_dome', addDays(today, -4), 20 * 60, 60, 'completed', '6'),
    mk('v_gulshan_goal', addDays(today, -11), 21 * 60, 60, 'completed', '5'),
    mk('v_badda_pitch', addDays(today, -15), 8 * 60, 60, 'cancelled', '4'),
  );
}

export async function getBookings(signal?: AbortSignal): Promise<Booking[]> {
  seedBookings();
  await wait(latency(), signal);
  return [...bookings];
}

export async function getBooking(id: string, signal?: AbortSignal): Promise<Booking> {
  seedBookings();
  await wait(latency() * 0.5, signal);
  const b = bookings.find((x) => x.id === id);
  if (!b) throw new ApiError('not_found', 'Booking not found.');
  return b;
}

export async function getNotifications(signal?: AbortSignal): Promise<NotificationItem[]> {
  await wait(latency(), signal);
  const now = Date.now();
  return [
    {
      id: 'n1',
      kind: 'booking',
      title: 'Game tomorrow at 7:00 PM',
      body: 'Bashundhara Arena · arrive 15 minutes early.',
      at: now - 3600_000,
      read: false,
    },
    {
      id: 'n2',
      kind: 'payment',
      title: 'Payment received',
      body: '৳1,500 via bKash for booking TS-261101-0842.',
      at: now - 26 * 3600_000,
      read: true,
    },
    {
      id: 'n3',
      kind: 'promo',
      title: 'Weekend slots are filling up',
      body: '3 turfs near you still have evening sessions.',
      at: now - 3 * 86400_000,
      read: true,
    },
  ];
}

export type ExploreLike = ExploreResult;

export async function getRequests(signal?: AbortSignal): Promise<PlayerRequest[]> {
  await wait(latency(), signal);
  const today = dhakaToday();
  return [
    {
      id: 'r1',
      kind: 'posted',
      venueName: 'Bashundhara Arena',
      area: 'Bashundhara',
      day: addDays(today, 2),
      start: 19 * 60,
      end: 20 * 60,
      spotsTotal: 3,
      spotsFilled: 1,
      sharePerPlayer: taka(150),
      status: 'open',
    },
    {
      id: 'r2',
      kind: 'joined',
      venueName: 'Kickoff Turf Uttara',
      area: 'Uttara',
      day: addDays(today, 3),
      start: 20 * 60 + 30,
      end: 22 * 60,
      spotsTotal: 2,
      spotsFilled: 2,
      sharePerPlayer: taka(375),
      status: 'accepted',
    },
    {
      id: 'r3',
      kind: 'joined',
      venueName: 'Goal Zone Gulshan',
      area: 'Gulshan',
      day: addDays(today, 5),
      start: 21 * 60,
      end: 22 * 60,
      spotsTotal: 4,
      spotsFilled: 2,
      sharePerPlayer: taka(220),
      status: 'pending',
    },
  ];
}

const REVIEW_TEXT = [
  'Great turf, lights are bright and the grass is in good shape. Booking was instant.',
  'Staff were friendly and the changing room was clean. Parking fills up after 8 PM.',
  'Good pitch for 5-a-side. Wish the water station was closer to the field.',
  'Our team plays here every Friday. Never had a double booking since using the app.',
];
const AUTHORS = ['Rafi Ahmed', 'Sami Khan', 'Tanvir Islam', 'Nafis Rahman'];

export async function getReviews(venueId: string, signal?: AbortSignal): Promise<ReviewSummary> {
  await wait(latency(), signal);
  const v = findVenue(venueId);
  const now = Date.now();
  const five = Math.round(v.reviewCount * 0.72);
  const four = Math.round(v.reviewCount * 0.18);
  const three = Math.round(v.reviewCount * 0.06);
  const two = Math.round(v.reviewCount * 0.02);
  return {
    average: v.rating,
    count: v.reviewCount,
    histogram: { 5: five, 4: four, 3: three, 2: two, 1: Math.max(0, v.reviewCount - five - four - three - two) },
    items: REVIEW_TEXT.map((text, i) => ({
      id: `${venueId}-r${i}`,
      author: AUTHORS[i],
      rating: i === 2 ? 4 : 5,
      at: now - (i + 1) * 4 * 86400_000,
      text,
    })),
  };
}
