import { randomInt } from 'node:crypto';

import type { PoolClient } from 'pg';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, generateSessions, hourlyFor, instant, isDayKey, minutesNowInDhaka, sessionPrice } from '../lib/time';
import { signPass } from '../lib/tokens';

import { getVenueRow, invalidateDay, photoUrl, rules } from './venues';

const MAX_ACTIVE_HOLDS = 3; // stops one account hoarding slots

type BookingRow = {
  id: string;
  code: string;
  user_id: string | null;
  venue_id: string;
  day: string;
  start_min: number;
  end_min: number;
  status: string;
  hold_expires_at: Date | null;
  price_lines: { label: string; detail?: string; amount: number }[];
  total: number;
};

const duration = (m: number) => (m % 60 === 0 ? (m === 60 ? '1 hour' : `${m / 60} hours`) : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** Idempotency: the same key from the same user always gets the same stored response. */
export async function remembered<T>(key: string | undefined, userId: string, route: string, make: () => Promise<T>): Promise<T> {
  if (!key) return make();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new ApiError('invalid', 'Invalid Idempotency-Key header.');
  const prev = await one<{ user_id: string; route: string; response: T }>('select user_id, route, response from idempotency_keys where key = $1', [key]);
  if (prev) {
    if (prev.user_id !== userId || prev.route !== route) throw new ApiError('conflict', 'This request key was already used.');
    return prev.response;
  }
  const res = await make();
  await q('insert into idempotency_keys(key, user_id, route, response) values ($1,$2,$3,$4) on conflict (key) do nothing', [key, userId, route, JSON.stringify(res)]);
  return res;
}

async function newCode(c: PoolClient, day: string) {
  for (let i = 0; i < 5; i++) {
    const code = `TS-${day.replaceAll('-', '').slice(2)}-${String(randomInt(0, 10000)).padStart(4, '0')}`;
    const taken = await c.query('select 1 from bookings where code = $1', [code]);
    if (!taken.rowCount) return code;
  }
  throw new ApiError('internal', 'Could not create a booking code. Try again.');
}

async function holdShape(b: BookingRow) {
  const v = await getVenueRow(b.venue_id);
  return {
    holdId: b.id,
    expiresAt: b.hold_expires_at ? new Date(b.hold_expires_at).getTime() : Date.now(),
    venue: { id: v.id, name: v.name, area: v.area, city: v.city, photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null, formats: v.formats },
    day: b.day,
    start: b.start_min,
    end: b.end_min,
    lines: b.price_lines,
    total: b.total,
    cancellationPolicy: v.cancellation_policy,
  };
}

export async function createHold(userId: string, slotId: string) {
  const m = /^(v_[A-Za-z0-9_]{1,40}):(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(slotId);
  if (!m || !isDayKey(m[2])) throw new ApiError('invalid', 'Unknown slot.');
  const [, venueId, day, startStr] = m;
  const start = Number(startStr);
  const today = dhakaToday();
  if (day < today || day > addDays(today, config.BOOKING_HORIZON_DAYS)) throw new ApiError('invalid', 'That date can’t be booked.');
  if (day === today && start <= minutesNowInDhaka()) throw new ApiError('slot_taken', 'That session has already started.');

  const v = await getVenueRow(venueId);
  const session = generateSessions({ openMin: v.open_min, closeMin: v.close_min, lengthMin: v.session_min, breakMin: v.break_min }).find((s) => s.start === start);
  if (!session) throw new ApiError('invalid', 'Unknown slot.');

  // Price is computed here, never taken from the app.
  const price = sessionPrice(hourlyFor(rules(v), day), v.session_min);
  const lines = [
    { label: 'Turf booking', detail: duration(v.session_min), amount: price },
    { label: 'Service fee', amount: config.SERVICE_FEE_POISHA },
  ];
  const total = price + config.SERVICE_FEE_POISHA;
  const from = instant(day, session.start);
  const to = instant(day, session.end);

  const row = await tx(async (c) => {
    // Queue concurrent holds on the same pitch (released at commit). Without this, two players
    // racing for one slot can deadlock inside the exclusion-constraint check instead of one
    // cleanly getting "slot taken". The exclusion constraint remains the real guarantee.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`pitch:${v.pitch_id}`]);
    const active = await c.query("select count(*)::int n from bookings where user_id = $1 and status = 'held' and hold_expires_at > now()", [userId]);
    if (active.rows[0].n >= MAX_ACTIVE_HOLDS) throw new ApiError('rate_limited', 'You already have slots on hold. Finish or wait for them to expire.');
    // Lazily release stale holds on this exact range so they never block a new booking.
    await c.query("update bookings set status = 'expired' where pitch_id = $1 and status = 'held' and hold_expires_at < now() and during && tstzrange($2, $3)", [v.pitch_id, from, to]);
    const code = await newCode(c, day);
    try {
      const r = await c.query<BookingRow>(
        `insert into bookings (code, user_id, venue_id, pitch_id, day, start_min, end_min, during, status, hold_expires_at, price_lines, total)
         values ($1,$2,$3,$4,$5,$6,$7,tstzrange($8,$9),'held', now() + make_interval(mins => $10), $11, $12)
         returning id, code, user_id, venue_id, day::text, start_min, end_min, status, hold_expires_at, price_lines, total`,
        [code, userId, v.id, v.pitch_id, day, session.start, session.end, from, to, config.HOLD_MINUTES, JSON.stringify(lines), total],
      );
      return r.rows[0];
    } catch (e) {
      const code = (e as { code?: string }).code;
      // 23P01 exclusion violation; 40P01 deadlock as a last-resort safety net.
      if (code === '23P01' || code === '40P01') throw new ApiError('slot_taken', 'Slot just got taken. Pick another time.');
      throw e;
    }
  });
  await invalidateDay(v.id, day);
  return holdShape(row);
}

export async function getHold(userId: string, holdId: string) {
  const b = await one<BookingRow>(
    "select id, code, user_id, venue_id, day::text, start_min, end_min, status, hold_expires_at, price_lines, total from bookings where id = $1 and user_id = $2",
    [holdId, userId],
  );
  if (!b) throw new ApiError('not_found', 'Your hold was not found. Please pick the slot again.');
  if (b.status === 'expired' || (b.status === 'held' && b.hold_expires_at && new Date(b.hold_expires_at) < new Date()))
    throw new ApiError('hold_expired', 'Your hold expired. Please pick the slot again.');
  if (b.status !== 'held' && b.status !== 'pending') throw new ApiError('conflict', 'This slot is already booked.');
  return holdShape(b);
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function bookingShape(b: BookingRow) {
  const v = await getVenueRow(b.venue_id).catch(() => null);
  const endAt = instant(b.day, b.end_min).getTime();
  const status = b.status === 'confirmed' && endAt < Date.now() ? 'completed' : b.status;
  return {
    id: b.id,
    code: b.code,
    venue: v
      ? { id: v.id, name: v.name, area: v.area, city: v.city, photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null, formats: v.formats, latitude: v.lat, longitude: v.lng }
      : { id: b.venue_id, name: 'Turf', area: '', city: '', photo: null, formats: [], latitude: 0, longitude: 0 },
    day: b.day,
    start: b.start_min,
    end: b.end_min,
    amountPaid: b.total,
    method: 'bKash' as const,
    status,
    // Signed entry pass, valid until 6 hours after the session ends.
    passToken: status === 'confirmed' || status === 'checked_in' ? signPass(b.id, Math.floor(endAt / 1000) + 6 * 3600) : '',
  };
}

export async function listBookings(userId: string) {
  const rows = await q<BookingRow>(
    `select id, code, user_id, venue_id, day::text, start_min, end_min, status, hold_expires_at, price_lines, total
       from bookings where user_id = $1 and status in ('confirmed','checked_in','completed','cancelled')
      order by day desc, start_min desc limit 200`,
    [userId],
  );
  return Promise.all(rows.map(bookingShape));
}

export async function getBooking(userId: string, id: string) {
  if (!isUuid(id)) throw new ApiError('not_found', 'Booking not found.');
  const b = await one<BookingRow>(
    'select id, code, user_id, venue_id, day::text, start_min, end_min, status, hold_expires_at, price_lines, total from bookings where id = $1 and user_id = $2',
    [id, userId],
  );
  if (!b || b.status === 'held' || b.status === 'pending' || b.status === 'expired') throw new ApiError('not_found', 'Booking not found.');
  return bookingShape(b);
}

/** Player cancellation: allowed until 24 h before kick-off; the payment is flagged for refund. */
export async function cancelBooking(userId: string, id: string) {
  if (!isUuid(id)) throw new ApiError('not_found', 'Booking not found.');
  const res = await tx(async (c) => {
    const b = (await c.query<BookingRow>('select id, venue_id, day::text, start_min, status from bookings where id = $1 and user_id = $2 for update', [id, userId])).rows[0];
    if (!b || b.status !== 'confirmed') throw new ApiError('not_found', 'Booking not found.');
    if (instant(b.day, b.start_min).getTime() - Date.now() < 24 * 3600_000) throw new ApiError('forbidden', 'Bookings can be cancelled up to 24 hours before kick-off.');
    await c.query("update bookings set status = 'cancelled', cancelled_at = now() where id = $1", [id]);
    await c.query("update payments set status = 'refund_required', updated_at = now() where booking_id = $1 and status = 'completed'", [id]);
    await c.query("insert into audit_log(actor_id, action, entity, entity_id) values ($1, 'booking.cancel', 'booking', $2)", [userId, id]);
    return b;
  });
  await invalidateDay(res.venue_id, res.day);
  return { ok: true };
}
