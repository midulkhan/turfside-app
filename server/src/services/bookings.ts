import { randomInt } from 'node:crypto';

import type { PoolClient } from 'pg';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, generateSessions, hourlyFor, instant, isDayKey, minutesNowInDhaka, sessionPrice } from '../lib/time';
import { signPass } from '../lib/tokens';

import { getVenueRow, getVenueRowExact, invalidateDay, photoUrl, refreshDays, rules } from './venues';

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

const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return { t: `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`, ap: h < 12 ? 'AM' : 'PM' };
};
/** "9:00–10:30 AM", "10:30 AM–12:00 PM" (the app's own format). */
const timeRange = (a: number, b: number) => {
  const x = clock(a);
  const y = clock(b);
  return x.ap === y.ap ? `${x.t}–${y.t} ${y.ap}` : `${x.t} ${x.ap}–${y.t} ${y.ap}`;
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

type OrderRow = {
  id: string;
  user_id: string;
  venue_id: string;
  status: string;
  hold_expires_at: Date | null;
  price_lines: { label: string; detail?: string; amount: number }[];
  total: number;
};
const ORDER_COLS = 'id, user_id, venue_id, status, hold_expires_at, price_lines, total';

export const MAX_SLOTS_PER_ORDER = 6;

/** Cart / checkout shape. `day`/`start`/`end` describe the first slot (older apps read only those). */
async function holdShape(o: OrderRow) {
  const v = await getVenueRow(o.venue_id);
  const slots = await q<{ id: string; day: string; start_min: number; end_min: number; total: number }>(
    "select id, day::text, start_min, end_min, total from bookings where order_id = $1 and status in ('held','pending','confirmed') order by day, start_min",
    [o.id],
  );
  const first = slots[0];
  return {
    holdId: o.id,
    expiresAt: o.hold_expires_at ? new Date(o.hold_expires_at).getTime() : Date.now(),
    venue: { id: v.id, name: v.name, area: v.area, city: v.city, photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null, formats: v.formats },
    slots: slots.map((b) => ({ id: `${v.id}:${b.day}:${b.start_min}`, day: b.day, start: b.start_min, end: b.end_min, price: b.total })),
    day: first?.day ?? dhakaToday(),
    start: first?.start_min ?? 0,
    end: first?.end_min ?? 0,
    lines: o.price_lines,
    total: o.total,
    cancellationPolicy: v.cancellation_policy,
  };
}

function parseSlot(slotId: string) {
  const m = /^(v_[A-Za-z0-9_]{1,40}):(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(slotId);
  if (!m || !isDayKey(m[2])) throw new ApiError('invalid', 'Unknown slot.');
  return { venueId: m[1], day: m[2], start: Number(m[3]) };
}

/** Expire a player's open order and its slots (inside a transaction). Returns the days it freed. */
async function closeOpenOrder(c: PoolClient, userId: string) {
  const freed = await c.query<{ venue_id: string; day: string }>(
    `with o as (
       update orders set status = 'expired', hold_expires_at = now()
        where user_id = $1 and status in ('held','pending') returning id
     )
     update bookings b set status = 'expired', hold_expires_at = now()
       from o where b.order_id = o.id and b.status in ('held','pending')
     returning b.venue_id, b.day::text`,
    [userId],
  );
  return freed.rows;
}

/**
 * Put slots in the player's cart. One cart per player, one turf per cart:
 * a new selection replaces the old cart, whose slots are freed for everyone
 * straight away. Sending exactly the slots already in the cart resumes it.
 */
export async function createHold(userId: string, slotIds: string[]) {
  const ids = [...new Set(slotIds)];
  if (!ids.length) throw new ApiError('invalid', 'Pick at least one slot.');
  if (ids.length > MAX_SLOTS_PER_ORDER) throw new ApiError('invalid', `You can book up to ${MAX_SLOTS_PER_ORDER} slots at a time.`);
  const parsed = ids.map(parseSlot);
  const venueId = parsed[0].venueId;
  if (parsed.some((p) => p.venueId !== venueId)) throw new ApiError('invalid', 'All slots in one booking must be at the same turf.');

  const today = dhakaToday();
  // From Postgres, not the cache: this sets the price and checks the schedule.
  const v = await getVenueRowExact(venueId);
  const sessions = generateSessions({ openMin: v.open_min, closeMin: v.close_min, lengthMin: v.session_min, breakMin: v.break_min });
  const picks = parsed
    .map((p) => {
      if (p.day < today || p.day > addDays(today, config.BOOKING_HORIZON_DAYS)) throw new ApiError('invalid', 'That date can’t be booked.');
      if (p.day === today && p.start <= minutesNowInDhaka()) throw new ApiError('slot_taken', 'That session has already started.');
      const session = sessions.find((s) => s.start === p.start);
      if (!session) throw new ApiError('invalid', 'Unknown slot.');
      // Price is computed here, never taken from the app.
      const price = sessionPrice(hourlyFor(rules(v), p.day), v.session_min);
      return { day: p.day, start: session.start, end: session.end, price, from: instant(p.day, session.start), to: instant(p.day, session.end) };
    })
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  const { lines, total } = priceOf(picks);
  const want = picks.map((p) => `${p.day}:${p.start}`).join(',');

  const result = await tx(async (c) => {
    // Queue concurrent holds on the same pitch (released at commit). Without this, two players
    // racing for one slot can deadlock inside the exclusion-constraint check instead of one
    // cleanly getting "slot taken". The exclusion constraint remains the real guarantee.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`pitch:${v.pitch_id}`]);
    // Serialise this player's own cart changes too.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`cart:${userId}`]);

    // Same slots as the open cart (e.g. back from checkout): resume it.
    const open = (
      await c.query<OrderRow & { slots: string }>(
        `select o.${ORDER_COLS.split(', ').join(', o.')},
                (select string_agg(b.day::text || ':' || b.start_min, ',' order by b.day, b.start_min) from bookings b where b.order_id = o.id) slots
           from orders o where o.user_id = $1 and o.status in ('held','pending') and o.hold_expires_at > now()`,
        [userId],
      )
    ).rows[0];
    if (open && open.venue_id === venueId && open.slots === want) return { order: open as OrderRow, freed: [] as { venue_id: string; day: string }[] };

    // Anything else replaces the cart: the old slots are freed right now.
    const freed = await closeOpenOrder(c, userId);
    // Lazily release stale holds on these ranges so they never block a new booking.
    for (const p of picks)
      await c.query("update bookings set status = 'expired' where pitch_id = $1 and status = 'held' and hold_expires_at < now() and during && tstzrange($2, $3)", [v.pitch_id, p.from, p.to]);

    const order = (
      await c.query<OrderRow>(
        `insert into orders (user_id, venue_id, status, hold_expires_at, price_lines, total)
         values ($1, $2, 'held', now() + make_interval(mins => $3), $4, $5) returning ${ORDER_COLS}`,
        [userId, v.id, config.HOLD_MINUTES, JSON.stringify(lines), total],
      )
    ).rows[0];
    try {
      for (const p of picks) {
        const code = await newCode(c, p.day);
        await c.query(
          `insert into bookings (code, user_id, venue_id, pitch_id, day, start_min, end_min, during, status, hold_expires_at, price_lines, total, order_id)
           values ($1,$2,$3,$4,$5,$6,$7,tstzrange($8,$9),'held', $10, $11, $12, $13)`,
          [code, userId, v.id, v.pitch_id, p.day, p.start, p.end, p.from, p.to, order.hold_expires_at,
            JSON.stringify([{ label: 'Turf booking', detail: duration(p.end - p.start), amount: p.price }]), p.price, order.id],
        );
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      // 23P01 exclusion violation; 40P01 deadlock as a last-resort safety net.
      if (code === '23P01' || code === '40P01')
        throw new ApiError('slot_taken', picks.length > 1 ? 'One of those slots just got taken. Pick again.' : 'Slot just got taken. Pick another time.');
      throw e;
    }
    return { order, freed };
  });
  const days = new Map<string, string>();
  for (const f of result.freed) days.set(`${f.venue_id}|${f.day}`, f.venue_id);
  for (const p of picks) days.set(`${v.id}|${p.day}`, v.id);
  await refreshDays([...days.keys()].map((k) => ({ venueId: days.get(k)!, day: k.split('|')[1] })));
  return holdShape(result.order);
}

/** One price line per slot ("Sat 7 Nov · 9:00–10:30 AM") plus the service fee. */
function priceOf(slots: { day: string; start: number; end: number; price: number }[]) {
  const lines = [
    ...slots.map((p) => ({ label: `${dayLabel(p.day)} · ${timeRange(p.start, p.end)}`, amount: p.price })),
    { label: 'Service fee', amount: config.SERVICE_FEE_POISHA },
  ];
  return { lines, total: slots.reduce((n, p) => n + p.price, 0) + config.SERVICE_FEE_POISHA };
}

/**
 * Take one slot out of the cart; it is free for everyone straight away (realtime fires
 * from the bookings trigger). Removing the last slot empties the cart.
 * Not allowed while a bKash payment for the cart is in progress.
 */
export async function removeHoldSlot(userId: string, holdId: string, slotId: string) {
  const p = parseSlot(slotId);
  const out = await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`cart:${userId}`]);
    const o = (await c.query<OrderRow>(`select ${ORDER_COLS} from orders where id = $1 and user_id = $2 for update`, [holdId, userId])).rows[0];
    if (!o || o.status === 'expired' || (o.hold_expires_at && new Date(o.hold_expires_at) < new Date()))
      throw new ApiError('hold_expired', 'Your hold expired. Please pick the slot again.');
    if (o.status === 'pending') throw new ApiError('conflict', 'A bKash payment for this cart is in progress. Finish or cancel it first.');
    if (o.status !== 'held') throw new ApiError('conflict', 'This order is already booked.');
    const gone = (
      await c.query<{ venue_id: string; day: string }>(
        "update bookings set status = 'expired', hold_expires_at = now() where order_id = $1 and status = 'held' and day = $2 and start_min = $3 returning venue_id, day::text",
        [o.id, p.day, p.start],
      )
    ).rows[0];
    if (!gone) throw new ApiError('not_found', 'That slot is not in your cart.');
    const rest = (
      await c.query<{ day: string; start_min: number; end_min: number; total: number }>(
        "select day::text, start_min, end_min, total from bookings where order_id = $1 and status = 'held' order by day, start_min",
        [o.id],
      )
    ).rows;
    if (!rest.length) {
      await c.query("update orders set status = 'expired', hold_expires_at = now() where id = $1", [o.id]);
      return { order: null, freed: gone };
    }
    const { lines, total } = priceOf(rest.map((b) => ({ day: b.day, start: b.start_min, end: b.end_min, price: b.total })));
    const order = (
      await c.query<OrderRow>(`update orders set price_lines = $2, total = $3 where id = $1 returning ${ORDER_COLS}`, [o.id, JSON.stringify(lines), total])
    ).rows[0];
    return { order, freed: gone };
  });
  await invalidateDay(out.freed.venue_id, out.freed.day);
  return out.order ? { released: false, hold: await holdShape(out.order) } : { released: true, hold: null };
}

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Give the cart back. Carts with a bKash payment in progress are left alone. */
export async function releaseHold(userId: string, holdId: string) {
  const rows = await tx(async (c) => {
    const o = (await c.query("update orders set status = 'expired', hold_expires_at = now() where id = $1 and user_id = $2 and status = 'held' returning id", [holdId, userId])).rows[0];
    if (!o) return [];
    return (
      await c.query<{ venue_id: string; day: string }>(
        "update bookings set status = 'expired', hold_expires_at = now() where order_id = $1 and status = 'held' returning venue_id, day::text",
        [holdId],
      )
    ).rows;
  });
  await refreshDays(rows.map((r) => ({ venueId: r.venue_id, day: r.day })));
  return { released: rows.length > 0 };
}

/** The player's cart (at most one order). */
export async function listHolds(userId: string) {
  const rows = await q<OrderRow>(
    `select ${ORDER_COLS} from orders where user_id = $1 and status in ('held','pending') and hold_expires_at > now() order by hold_expires_at`,
    [userId],
  );
  return Promise.all(rows.map(holdShape));
}

export async function getHold(userId: string, holdId: string) {
  const o = await one<OrderRow>(`select ${ORDER_COLS} from orders where id = $1 and user_id = $2`, [holdId, userId]);
  if (!o) throw new ApiError('not_found', 'Your hold was not found. Please pick the slot again.');
  if (o.status === 'expired' || (o.status === 'held' && o.hold_expires_at && new Date(o.hold_expires_at) < new Date()))
    throw new ApiError('hold_expired', 'Your hold expired. Please pick the slot again.');
  if (o.status !== 'held' && o.status !== 'pending') throw new ApiError('conflict', 'This slot is already booked.');
  return holdShape(o);
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
