import { randomInt } from 'node:crypto';

import type { PoolClient } from 'pg';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { partialQuote } from '../lib/partial';
import { addDays, dhakaToday, instant, isDayKey, minutesNowInDhaka, priceFor, sessionsFor } from '../lib/time';
import { signPass, signPass2 } from '../lib/tokens';

import { onBookingCancelled } from './matches';
import { getVenueRow, getVenueRowExact, invalidateDay, photoUrl, refreshDays, rules, slotRules } from './venues';

const BOOKING_COLS = `id, code, user_id, venue_id, day::text, start_min, end_min, status, hold_expires_at, price_lines, total, order_id, note, source,
  pay_mode, paid_online,
  (select name from pitches pi where pi.id = bookings.pitch_id) as pitch_name`;

/** One slot of a booking made of several (same order / payment). */
/** amountPaid: what came through the app; total: the slot's price (the rest is paid at the turf). */
type Slot = { id: string; code: string; day: string; start: number; end: number; status: string; amountPaid: number; total: number };
const VISIBLE = "status in ('confirmed','checked_in','completed','cancelled')";

/**
 * Tickets from slots: back-to-back slots on the same day (one payment) make one ticket
 * ("1:30–4:00"); a gap starts another. Returns, for every booking id in these orders, the run
 * (ticket) it belongs to, and for each order all of its runs.
 */
async function runsFor(userId: string, rows: { id: string; order_id?: string | null }[]) {
  const orders = [...new Set(rows.map((r) => r.order_id).filter((x): x is string => !!x))];
  const byId = new Map<string, Slot[]>();
  const byOrder = new Map<string, Slot[][]>();
  if (!orders.length) return { byId, byOrder };
  const all = await q<{ id: string; code: string; day: string; start_min: number; end_min: number; status: string; total: number; paid: number; order_id: string }>(
    `select id, code, day::text, start_min, end_min, status, total, coalesce(paid_online, total) paid, order_id from bookings
      where order_id = any($1::uuid[]) and user_id = $2 and ${VISIBLE} order by order_id, day, start_min`,
    [orders, userId],
  );
  for (const x of all) {
    const slot: Slot = {
      id: x.id,
      code: x.code,
      day: x.day,
      start: x.start_min,
      end: x.end_min,
      status: x.status === 'confirmed' && instant(x.day, x.end_min).getTime() < Date.now() ? 'completed' : x.status,
      amountPaid: Number(x.paid),
      total: Number(x.total),
    };
    const runs = byOrder.get(x.order_id) ?? [];
    const last = runs.at(-1)?.at(-1);
    // Same ticket only if it starts exactly when the previous slot ends, same day, same state.
    const joins = last && last.day === slot.day && last.end === slot.start && (last.status === 'cancelled') === (slot.status === 'cancelled');
    if (joins) runs.at(-1)!.push(slot);
    else runs.push([slot]);
    byOrder.set(x.order_id, runs);
  }
  for (const runs of byOrder.values()) for (const run of runs) for (const sl of run) byId.set(sl.id, run);
  return { byId, byOrder };
}

/** The bookings one ticket covers (for check-in): its back-to-back slots, or just itself. */
export async function ticketBookingIds(bookingId: string) {
  const b = await one<{ id: string; order_id: string | null; user_id: string }>('select id, order_id, user_id from bookings where id = $1', [bookingId]);
  if (!b?.order_id) return [bookingId];
  const run = (await runsFor(b.user_id, [b])).byId.get(b.id);
  return run ? run.map((x) => x.id) : [bookingId];
}

/** A ticket's neighbours: the other tickets bought in the same payment. */
const otherTickets = (runs: Slot[][] | undefined, run: Slot[]) =>
  (runs ?? [])
    .filter((r) => r[0].id !== run[0].id)
    .map((r) => ({ id: r[0].id, code: r[0].code, day: r[0].day, start: r[0].start, end: r.at(-1)!.end, status: r[0].status }));

/** SQL: one row per ticket (first slot of each run of back-to-back slots), for the lists. */
const TICKET_ROWS = (where: string) => `select * from (
    select x.*, row_number() over (partition by coalesce(order_id, id), run order by day, start_min) rn from (
      select y.*, sum(brk) over (partition by coalesce(order_id, id) order by day, start_min rows unbounded preceding) run from (
        select ${BOOKING_COLS},
          case when lag(end_min) over w = start_min and lag(day) over w = day
                    and (lag(status) over w = 'cancelled') = (status = 'cancelled') then 0 else 1 end brk
          from bookings where ${where}
          window w as (partition by coalesce(order_id, id) order by day, start_min)
      ) y
    ) x
  ) b where rn = 1`;

/** Who booked: printed on the entry pass. */
type Holder = { name: string; phone: string };
async function holderOf(userId: string): Promise<Holder> {
  return (await one<Holder>('select name, phone from users where id = $1', [userId])) ?? { name: '', phone: '' };
}
const maskPhone = (p: string) => (p.length >= 7 ? `${p.slice(0, 3)}${'*'.repeat(p.length - 6)}${p.slice(-3)}` : p);
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

type BookingRow = {
  pitch_name?: string | null;
  /** app / link = paid in the app; walkin = added by the turf (matched to this player's account). */
  source?: string | null;
  note?: string | null;
  order_id?: string | null;
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
  /** 'partial': 500 tk per slot paid in the app, the rest at the turf. */
  pay_mode?: 'full' | 'partial' | null;
  /** Paid through TurfSides (null = all of it). */
  paid_online?: number | string | null;
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
    /** Checkout's "Partial payment" option: 500 tk per slot now, the rest at the turf. */
    partial: partialQuote(slots.map((b) => Number(b.total))),
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
  if (v.booking_paused) throw new ApiError('slot_taken', v.booking_notice || 'This turf is not taking new bookings right now.');
  const slotRulesV = slotRules(v);
  const picks = parsed
    .map((p) => {
      if (p.day < today || p.day > addDays(today, config.BOOKING_HORIZON_DAYS)) throw new ApiError('invalid', 'That date can’t be booked.');
      if (p.day === today && p.start <= minutesNowInDhaka()) throw new ApiError('slot_taken', 'That session has already started.');
      const session = sessionsFor(slotRulesV, p.day).find((s) => s.start === p.start);
      if (!session) throw new ApiError('invalid', 'Unknown slot.');
      // Price is computed here, never taken from the app.
      const price = priceFor(rules(v), p.day, session);
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
    // The owner closed this time (maintenance, tournament, walk-in…): it can't be booked.
    for (const p of picks) {
      const blocked = await c.query('select 1 from venue_blocks where pitch_id = $1 and during && tstzrange($2, $3) limit 1', [v.pitch_id, p.from, p.to]);
      if (blocked.rowCount) throw new ApiError('slot_taken', 'That time is not available any more. Pick another time.');
    }

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

/** One price line per slot ("Sat 7 Nov · 9:00–10:30 AM"), plus the service fee only when there is one. */
function priceOf(slots: { day: string; start: number; end: number; price: number }[]) {
  const lines = [
    ...slots.map((p) => ({ label: `${dayLabel(p.day)} · ${timeRange(p.start, p.end)}`, amount: p.price })),
    ...(config.SERVICE_FEE_POISHA > 0 ? [{ label: 'Service fee', amount: config.SERVICE_FEE_POISHA }] : []),
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

export async function bookingShape(b: BookingRow, holder?: Holder, run: Slot[] = [], others: ReturnType<typeof otherTickets> = []) {
  // A ticket of back-to-back slots shows as one: first start to last end, all of it paid.
  const merged = run.length > 1;
  const start = merged ? run[0].start : b.start_min;
  const end = merged ? run.at(-1)!.end : b.end_min;
  const total = merged ? run.reduce((t, x) => t + x.total, 0) : Number(b.total);
  // Walk-ins never go through the app: what the turf charged is what's shown.
  const paid = b.source === 'walkin' ? total : merged ? run.reduce((t, x) => t + x.amountPaid, 0) : Number(b.paid_online ?? b.total);
  const v = await getVenueRow(b.venue_id).catch(() => null);
  const endAt = instant(b.day, end).getTime();
  const status = b.status === 'confirmed' && endAt < Date.now() ? 'completed' : b.status;
  return {
    id: b.id,
    code: b.code,
    venue: v
      ? { id: v.id, name: v.name, area: v.area, city: v.city, photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null, formats: v.formats, latitude: v.lat, longitude: v.lng }
      : { id: b.venue_id, name: 'Turf', area: '', city: '', photo: null, formats: [], latitude: 0, longitude: 0 },
    day: b.day,
    start,
    end,
    amountPaid: paid,
    /** The ticket's full price; `dueAtVenue` is what's left to pay at the turf (partial payment). */
    total,
    dueAtVenue: Math.max(0, total - paid),
    payMode: (b.pay_mode ?? 'full') as 'full' | 'partial',
    // Walk-ins were booked (and paid, if at all) at the turf: the app shows "via the turf".
    method: (b.source === 'walkin' ? 'the turf' : 'bKash') as 'bKash',
    status,
    /** How many booked slots this ticket covers (back-to-back slots merge into one ticket). */
    slotCount: merged ? run.length : 1,
    /** Other tickets bought in the same payment (slots that weren't back to back). */
    otherTickets: others,
    /** The customer's note to the turf, added at checkout. */
    note: b.note ?? null,
    // Signed entry pass carrying the ticket itself (docs/pass-qr.md), valid until 6 hours after
    // the session ends. Without the holder (not expected) it falls back to the id-only v1 pass.
    passToken:
      status === 'confirmed' || status === 'checked_in'
        ? holder
          ? signPass2({
              code: b.code,
              venue: v?.name ?? 'Turf',
              area: v?.area ?? '',
              pitch: b.pitch_name ?? 'Main pitch',
              format: v?.formats?.[0] ?? '',
              date: b.day,
              from: hhmm(start),
              to: hhmm(end),
              name: holder.name,
              phone: maskPhone(holder.phone),
              paid: Math.round(paid / 100),
              via: b.source === 'walkin' ? 'At the turf' : 'bKash',
              exp: Math.floor(endAt / 1000) + 6 * 3600,
            })
          : signPass(b.id, Math.floor(endAt / 1000) + 6 * 3600)
        : '',
  };
}

export async function listBookings(userId: string) {
  const rows = await q<BookingRow>(
    `${TICKET_ROWS(`user_id = $1 and ${VISIBLE}`)} order by day desc, start_min desc limit 200`,
    [userId],
  );
  const holder = await holderOf(userId);
  const runs = await runsFor(userId, rows);
  return Promise.all(rows.map((r) => shapeTicket(r, holder, runs)));
}

/**
 * One page of bookings. open = a game still ahead (confirmed or checked in, today or later),
 * soonest first; closed = everything else, latest first; all = open then closed.
 * The first page of all/open also carries `next`: the very next game, shown on top.
 */
export async function pageBookings(userId: string, filter: 'all' | 'open' | 'closed', cursor: number, limit: number) {
  const today = dhakaToday();
  const holder = await holderOf(userId);
  const OPEN = "status in ('confirmed','checked_in') and day >= $2::date";
  const OPEN_OUT = "status in ('confirmed','checked_in') and day::date >= $2::date"; // day is text in the outer select
  const where = filter === 'open' ? OPEN : filter === 'closed' ? `not (${OPEN})` : 'true';
  // One item per ticket: back-to-back slots bought together are one ticket (its first slot leads).
  const rows = await q<BookingRow>(
    `${TICKET_ROWS(`user_id = $1 and ${VISIBLE} and ${where}`)}
      order by (${OPEN_OUT}) desc,
               case when ${OPEN_OUT} then day end asc, case when ${OPEN_OUT} then start_min end asc,
               day desc, start_min desc, id
      offset $3 limit $4`,
    [userId, today, cursor, limit + 1],
  );
  const page = rows.slice(0, limit);
  const next =
    cursor === 0 && filter !== 'closed'
      ? await one<BookingRow>(
          `select ${BOOKING_COLS}
             from bookings where user_id = $1 and ${OPEN} order by day, start_min, id limit 1`,
          [userId, today],
        )
      : null;
  const runs = await runsFor(userId, next ? [...page, next] : page);
  return {
    items: await Promise.all(page.map((r) => shapeTicket(r, holder, runs))),
    next: next ? await shapeTicket(next, holder, runs) : null,
    nextCursor: rows.length > limit ? cursor + limit : null,
  };
}

export async function getBooking(userId: string, id: string) {
  if (!isUuid(id)) throw new ApiError('not_found', 'Booking not found.');
  const b = await one<BookingRow>(
    `select ${BOOKING_COLS} from bookings where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (!b || b.status === 'held' || b.status === 'pending' || b.status === 'expired') throw new ApiError('not_found', 'Booking not found.');
  // Any slot of a ticket opens the ticket itself (its first slot leads).
  const runs = await runsFor(userId, [b]);
  const lead = runs.byId.get(b.id)?.[0];
  const row = lead && lead.id !== b.id ? ((await one<BookingRow>(`select ${BOOKING_COLS} from bookings where id = $1 and user_id = $2`, [lead.id, userId])) ?? b) : b;
  const m = await one<{ id: string }>("select id from player_requests where booking_id = $1 and status <> 'cancelled'", [row.id]);
  return { ...(await shapeTicket(row, await holderOf(userId), runs)), matchId: m?.id ?? null };
}

function shapeTicket(r: BookingRow, holder: Holder, runs: Awaited<ReturnType<typeof runsFor>>) {
  const run = runs.byId.get(r.id) ?? [];
  return bookingShape(r, holder, run, run.length ? otherTickets(runs.byOrder.get(r.order_id ?? ''), run) : []);
}

/** Player cancellation: allowed until 24 h before kick-off; the payment is flagged for refund. */
/** Players can cancel up to 6 hours before kick-off; what they paid in the app is refunded. */
export const CANCEL_BEFORE_MS = 6 * 3600_000;

export async function cancelBooking(userId: string, id: string) {
  if (!isUuid(id)) throw new ApiError('not_found', 'Booking not found.');
  const res = await tx(async (c) => {
    const b = (await c.query<BookingRow>('select id, venue_id, day::text, start_min, status, order_id, source from bookings where id = $1 and user_id = $2 for update', [id, userId])).rows[0];
    if (!b || b.status !== 'confirmed') throw new ApiError('not_found', 'Booking not found.');
    if (b.source === 'walkin') throw new ApiError('forbidden', 'The turf booked this for you. Contact the turf to change or cancel it.');
    // A ticket of back-to-back slots is cancelled as a whole.
    const run = (await runsFor(userId, [b])).byId.get(b.id) ?? [];
    const ids = run.length ? run.filter((x) => x.status === 'confirmed').map((x) => x.id) : [id];
    const first = run[0] ?? { day: b.day, start: b.start_min };
    if (instant(first.day, first.start).getTime() - Date.now() < CANCEL_BEFORE_MS) throw new ApiError('forbidden', 'Bookings can be cancelled up to 6 hours before kick-off.');
    await c.query("update bookings set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[]) and status = 'confirmed'", [ids]);
    await c.query("update payments set status = 'refund_required', updated_at = now() where booking_id = any($1::uuid[]) and status = 'completed'", [ids]);
    for (const x of ids) await c.query("insert into audit_log(actor_id, action, entity, entity_id) values ($1, 'booking.cancel', 'booking', $2)", [userId, x]);
    return b;
  });
  await invalidateDay(res.venue_id, res.day);
  await onBookingCancelled(id);
  return { ok: true };
}
