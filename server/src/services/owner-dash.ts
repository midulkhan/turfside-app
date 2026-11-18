import { randomInt } from 'node:crypto';

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, instant, isDayKey, priceFor, sessionsFor, type SessionSetRow } from '../lib/time';

import { ticketBookingIds } from './bookings';
import { onBookingCancelled } from './matches';
import { getOwnedVenueRow, photoUrl, rules, slotRules, type VenueRow } from './venues';

/**
 * Owner dashboard (web, and later the owner mobile app): everything under /v1/owner/* beyond
 * the turf profile itself (services/owner.ts). Every query is scoped to turfs this owner owns.
 * Money in responses is taka; times are minutes after the venue day's Dhaka midnight (like the
 * player API), inputs take "HH:MM".
 *
 * Walk-in bookings go through the same tables, pitch lock and exclusion constraint as app
 * bookings, so the two can never overlap, and the player app sees them as booked instantly.
 */

const ACTIVE = "('held','pending','confirmed','checked_in')";
const PAID = "('confirmed','checked_in','completed')";
const taka = (poisha: number | string | null | undefined) => Math.round(Number(poisha ?? 0)) / 100;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like "06:00" or "23:30".');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const dayKey = z.string().refine(isDayKey, 'Use a date like 2026-12-16.');
const MAX_RANGE_DAYS = 400;

async function audit(c: PoolClient | null, actor: string, action: string, entity: string, id: string, data?: unknown) {
  const sql = 'insert into audit_log(actor_id, action, entity, entity_id, data) values ($1,$2,$3,$4,$5)';
  const args = [actor, action, entity, id, data == null ? null : JSON.stringify(data)];
  if (c) await c.query(sql, args);
  else await q(sql, args);
}

/** The owner's turf ids: one, checked, or all of them. */
async function venueScope(ownerId: string, venueId?: string) {
  if (venueId) {
    const v = await one<{ id: string }>("select id from venues where id = $1 and owner_id = $2 and status <> 'suspended'", [
      venueId,
      ownerId,
    ]);
    if (!v) throw new ApiError('not_found', 'Turf not found.');
    return [v.id];
  }
  return (await q<{ id: string }>("select id from venues where owner_id = $1 and status <> 'suspended'", [ownerId])).map((r) => r.id);
}

function daysBetween(from: string, to: string) {
  const n = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
  if (n < 1) throw new ApiError('invalid', '"to" must be on or after "from".');
  if (n > MAX_RANGE_DAYS) throw new ApiError('invalid', `Pick at most ${MAX_RANGE_DAYS} days.`);
  return n;
}

// ── Bookings ─────────────────────────────────────────────────────────────────────────────

type BookingRow = {
  id: string;
  code: string;
  venue_id: string;
  venue_name: string;
  day: string;
  start_min: number;
  end_min: number;
  status: string;
  source: string;
  total: string;
  created_at: Date;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  checked_in_at: Date | null;
  order_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_phone: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  note: string | null;
};
const BOOKING_SELECT = `
  select b.id, b.code, b.venue_id, v.name venue_name, b.day::text, b.start_min, b.end_min, b.status, b.source, b.total,
         b.created_at, b.confirmed_at, b.cancelled_at, b.checked_in_at, b.order_id, b.user_id,
         u.name user_name, u.phone user_phone, b.guest_name, b.guest_phone, b.note
    from bookings b join venues v on v.id = b.venue_id left join users u on u.id = b.user_id`;

function bookingOut(b: BookingRow) {
  const ended = instant(b.day, b.end_min).getTime() < Date.now();
  return {
    id: b.id,
    code: b.code,
    venue: { id: b.venue_id, name: b.venue_name },
    day: b.day,
    start: b.start_min,
    end: b.end_min,
    status: b.status === 'confirmed' && ended ? 'completed' : b.status,
    source: b.source as 'app' | 'link' | 'walkin',
    amount: taka(b.total),
    customer: b.user_id
      ? { name: b.user_name ?? 'Player', phone: b.user_phone ? `+880${b.user_phone}` : null, guest: false }
      : { name: b.guest_name ?? 'Walk-in', phone: b.guest_phone, guest: true },
    note: b.note,
    orderId: b.order_id,
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    cancelledAt: b.cancelled_at,
    checkedInAt: b.checked_in_at,
  };
}
export type OwnerBooking = ReturnType<typeof bookingOut>;

export const bookingQuery = z.object({
  venueId: z.string().max(60).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
  status: z.enum(['all', 'upcoming', 'confirmed', 'checked_in', 'completed', 'cancelled']).default('all'),
  source: z.enum(['all', 'app', 'walkin']).default('all'),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['day_asc', 'day_desc', 'created_desc']).default('day_desc'),
  cursor: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function listBookings(ownerId: string, f: z.infer<typeof bookingQuery>) {
  const venues = await venueScope(ownerId, f.venueId);
  if (!venues.length) return { items: [], total: 0, nextCursor: null };
  const where: string[] = ['b.venue_id = any($1::text[])', `b.status in ('confirmed','checked_in','completed','cancelled')`];
  const args: unknown[] = [venues];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (f.from) where.push(`b.day >= ${arg(f.from)}::date`);
  if (f.to) where.push(`b.day <= ${arg(f.to)}::date`);
  // "completed" = played: checked in, or confirmed and already over.
  const endTs = 'upper(b.during)';
  if (f.status === 'upcoming') where.push(`b.status in ('confirmed','checked_in') and ${endTs} >= now()`);
  else if (f.status === 'confirmed') where.push(`b.status = 'confirmed' and ${endTs} >= now()`);
  else if (f.status === 'completed')
    where.push(`(b.status = 'completed' or (b.status in ('confirmed','checked_in') and ${endTs} < now()))`);
  else if (f.status !== 'all') where.push(`b.status = ${arg(f.status)}`);
  if (f.source === 'walkin') where.push(`b.source = 'walkin'`);
  else if (f.source === 'app') where.push(`b.source <> 'walkin'`);
  if (f.q) {
    const like = arg(`%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(
      `(b.code ilike ${like} or u.name ilike ${like} or u.phone ilike ${like} or b.guest_name ilike ${like} or b.guest_phone ilike ${like})`,
    );
  }
  const order =
    f.sort === 'day_asc' ? 'b.day, b.start_min' : f.sort === 'created_desc' ? 'b.created_at desc' : 'b.day desc, b.start_min desc';
  const w = where.join(' and ');
  const [rows, count] = await Promise.all([
    q<BookingRow>(`${BOOKING_SELECT} where ${w} order by ${order}, b.id offset ${arg(f.cursor)} limit ${arg(f.limit + 1)}`, args),
    one<{ n: number }>(
      `select count(*)::int n from bookings b left join users u on u.id = b.user_id where ${w}`,
      args.slice(0, args.length - 2),
    ),
  ]);
  return {
    items: rows.slice(0, f.limit).map(bookingOut),
    total: count?.n ?? 0,
    nextCursor: rows.length > f.limit ? f.cursor + f.limit : null,
  };
}

export async function getBooking(ownerId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'Booking not found.');
  const b = await one<BookingRow>(`${BOOKING_SELECT} where b.id = $1 and v.owner_id = $2`, [id, ownerId]);
  if (!b || !['confirmed', 'checked_in', 'completed', 'cancelled'].includes(b.status))
    throw new ApiError('not_found', 'Booking not found.');
  return bookingOut(b);
}

// ── Day sheet: the day as it really is ───────────────────────────────────────────────────
//
// Each booking appears ONCE, at the time it was booked, with the amount it was booked for — even if
// the owner has since changed the sessions (a 4:40–6:40 booking stays 4:40–6:40). The current
// sessions fill the rest of the day: a session that any booking overlaps can't be sold, so it is not
// listed separately. Counts and revenue use the same rules as the overview (bookings of this day,
// confirmed / checked in / completed, by amount charged).

const SHEET_STATUSES = "('held','pending','confirmed','checked_in','completed')";

export async function daySheet(ownerId: string, venueId: string, day: string) {
  const v = await getOwnedVenueRow(ownerId, venueId);
  const from = instant(day, 0);
  const to = instant(day, Math.max(v.close_min, 1440) + 60);
  const [bookings, blocks] = await Promise.all([
    q<BookingRow & { s: Date; e: Date }>(
      `${BOOKING_SELECT.replace('select b.id,', 'select lower(b.during) s, upper(b.during) e, b.id,')}
        where b.pitch_id = $1 and b.during && tstzrange($2, $3) and b.status in ${SHEET_STATUSES}
          and not (b.status in ('held','pending') and b.hold_expires_at < now())
        order by lower(b.during)`,
      [v.pitch_id, from, to],
    ),
    q<{ id: string; s: Date; e: Date; reason: string | null; kind: string; tournament_id: string | null }>(
      'select id, lower(during) s, upper(during) e, reason, kind, tournament_id from venue_blocks where pitch_id = $1 and during && tstzrange($2, $3) order by lower(during)',
      [v.pitch_id, from, to],
    ),
  ]);
  const base = from.getTime();
  const rel = (d: Date) => Math.round((d.getTime() - base) / 60_000);
  const now = Date.now();
  const prices = rules(v);

  type Row = {
    kind: 'booking' | 'session';
    start: number;
    end: number;
    /** Booking rows: the amount booked for. Session rows: today's price for that session. */
    price: number;
    status: 'available' | 'held' | 'booked' | 'checked_in' | 'blocked';
    past: boolean;
    booking: ReturnType<typeof bookingOut> | null;
    block: { id: string; reason: string | null; kind: string; tournamentId: string | null } | null;
    /** Set when this booking belongs to another day's sheet (a late session running past midnight). */
    bookedFor: string | null;
    /** Booking rows: today's sessions it overlaps without matching them (they can't be sold). */
    covers: { start: number; end: number }[];
  };
  const rows: Row[] = [];

  for (const b of bookings) {
    const held = b.status === 'held' || b.status === 'pending';
    rows.push({
      kind: 'booking',
      start: rel(b.s),
      end: rel(b.e),
      price: taka(b.total),
      status: held ? 'held' : b.status === 'checked_in' ? 'checked_in' : 'booked',
      past: b.e.getTime() < now,
      // Who is paying stays private until they've paid.
      booking: held ? null : bookingOut(b),
      block: null,
      bookedFor: b.day === day ? null : b.day,
      covers: [],
    });
  }
  let scheduled = 0;
  for (const s of sessionsFor(slotRules(v), day)) {
    scheduled++;
    const a = instant(day, s.start).getTime();
    const e = instant(day, s.end).getTime();
    const hits = bookings.flatMap((x, i) => (x.s.getTime() < e && x.e.getTime() > a ? [i] : []));
    if (hits.length) {
      // Taken: the booking row shows it. Say so when the times differ (sessions changed after booking).
      for (const i of hits) if (rows[i]!.start !== s.start || rows[i]!.end !== s.end) rows[i]!.covers.push({ start: s.start, end: s.end });
      continue;
    }
    const bl = blocks.find((x) => x.s.getTime() < e && x.e.getTime() > a);
    rows.push({
      kind: 'session',
      start: s.start,
      end: s.end,
      price: taka(priceFor(prices, day, s)),
      status: bl ? 'blocked' : 'available',
      past: e < now,
      booking: null,
      block: bl ? { id: bl.id, reason: bl.reason, kind: bl.kind, tournamentId: bl.tournament_id } : null,
      bookedFor: null,
      covers: [],
    });
  }
  rows.sort((x, y) => x.start - y.start || (x.kind === 'booking' ? -1 : 1));

  // Same rule as the overview chart: this day's bookings that are confirmed, checked in or completed.
  const paid = bookings.filter((b) => b.day === day && ['confirmed', 'checked_in', 'completed'].includes(b.status));
  return {
    venue: { id: v.id, name: v.name, status: v.status },
    day,
    sessions: rows,
    summary: {
      /** Sessions in today's schedule. */
      total: scheduled,
      /** Bookings for this day (each counted once, however long it is). */
      booked: paid.length,
      bookedHours: Math.round((paid.reduce((n, b) => n + (b.end_min - b.start_min), 0) / 60) * 10) / 10,
      /** Players paying right now (held for a few minutes). */
      held: rows.filter((r) => r.status === 'held').length,
      /** Sessions you closed. */
      blocked: rows.filter((r) => r.kind === 'session' && r.status === 'blocked').length,
      /** Sessions players can still book. */
      available: rows.filter((r) => r.kind === 'session' && r.status === 'available' && !r.past).length,
      /** Amount booked for this day (the turf's price; the TurfSides service fee is not included). */
      revenue: taka(paid.reduce((n, b) => n + Number(b.total), 0)),
    },
  };
}

// ── Walk-in / phone bookings ─────────────────────────────────────────────────────────────

export const walkinInput = z.object({
  venueId: z.string().max(60),
  day: dayKey,
  /** Session starts (minutes) from the day sheet; back-to-back or not, up to 8. */
  starts: z.array(z.number().int().min(0).max(2880)).min(1).max(8),
  guestName: z.string().trim().min(2).max(80),
  guestPhone: z.string().trim().max(20).optional(),
  /** Total actually charged, in taka (discounts); left out = the listed prices. */
  amount: z.number().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

async function newCode(c: PoolClient, day: string) {
  for (let i = 0; i < 5; i++) {
    const code = `TS-${day.replaceAll('-', '').slice(2)}-${String(randomInt(0, 10000)).padStart(4, '0')}`;
    if (!(await c.query('select 1 from bookings where code = $1', [code])).rowCount) return code;
  }
  throw new ApiError('internal', 'Could not create a booking code. Try again.');
}

export async function createWalkin(ownerId: string, b: z.infer<typeof walkinInput>) {
  const v = await getOwnedVenueRow(ownerId, b.venueId);
  const today = dhakaToday();
  if (b.day < addDays(today, -7) || b.day > addDays(today, config.BOOKING_HORIZON_DAYS))
    throw new ApiError('invalid', 'Pick a date within the booking window.');
  const sessions = sessionsFor(slotRules(v), b.day);
  const prices = rules(v);
  const picks = [...new Set(b.starts)]
    .map((start) => {
      const s = sessions.find((x) => x.start === start);
      if (!s) throw new ApiError('invalid', 'One of those sessions does not exist any more. Reload and pick again.');
      return { ...s, price: priceFor(prices, b.day, s), from: instant(b.day, s.start), to: instant(b.day, s.end) };
    })
    .sort((x, y) => x.start - y.start);
  const listed = picks.reduce((n, p) => n + p.price, 0);
  const charged = b.amount == null ? listed : Math.round(b.amount * 100);
  // Spread a discount over the slots (last slot takes the rounding).
  const shares = picks.map((p) => (listed ? Math.floor((p.price * charged) / listed) : Math.floor(charged / picks.length)));
  shares[shares.length - 1]! += charged - shares.reduce((n, x) => n + x, 0);

  const ids = await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`pitch:${v.pitch_id}`]);
    const out: string[] = [];
    for (const [i, p] of picks.entries()) {
      await c.query(
        "update bookings set status = 'expired' where pitch_id = $1 and status = 'held' and hold_expires_at < now() and during && tstzrange($2, $3)",
        [v.pitch_id, p.from, p.to],
      );
      const blocked = await c.query('select 1 from venue_blocks where pitch_id = $1 and during && tstzrange($2, $3) limit 1', [
        v.pitch_id,
        p.from,
        p.to,
      ]);
      if (blocked.rowCount) throw new ApiError('slot_taken', 'That time is closed. Remove the closure first.');
      const code = await newCode(c, b.day);
      try {
        const r = await c.query<{ id: string }>(
          `insert into bookings (code, user_id, venue_id, pitch_id, day, start_min, end_min, during, status, source, price_lines, total,
                                 confirmed_at, guest_name, guest_phone, note, created_by)
           values ($1, null, $2, $3, $4, $5, $6, tstzrange($7, $8), 'confirmed', 'walkin', $9, $10, now(), $11, $12, $13, $14) returning id`,
          [
            code,
            v.id,
            v.pitch_id,
            b.day,
            p.start,
            p.end,
            p.from,
            p.to,
            JSON.stringify([{ label: 'Walk-in booking', amount: shares[i] }]),
            shares[i],
            b.guestName,
            b.guestPhone || null,
            b.note || null,
            ownerId,
          ],
        );
        out.push(r.rows[0]!.id);
      } catch (e) {
        if ((e as { code?: string }).code === '23P01')
          throw new ApiError('slot_taken', 'Someone just booked that time. Pick another session.');
        throw e;
      }
    }
    await audit(c, ownerId, 'booking.walkin', 'venue', v.id, { day: b.day, starts: picks.map((p) => p.start), amount: charged / 100 });
    return out;
  });
  return { bookings: await Promise.all(ids.map((id) => getBooking(ownerId, id))) };
}

// ── Edit a walk-in ────────────────────────────────────────────────────────────────────────
// Only bookings the owner added (source = 'walkin'). App bookings were paid by a player through
// the app and can't be changed here — they can only be cancelled (with a refund).

export const walkinEditInput = z
  .object({
    guestName: z.string().trim().min(2).max(80).optional(),
    guestPhone: z.string().trim().max(20).optional(),
    note: z.string().trim().max(300).optional(),
    /** Amount charged, in taka. */
    amount: z.number().min(0).max(1_000_000).optional(),
    /** Move to another session: the session's start (minutes) on `day`. */
    day: dayKey.optional(),
    start: z.number().int().min(0).max(2880).optional(),
  })
  .strict()
  .refine((x) => (x.day === undefined) === (x.start === undefined), { message: 'Send both day and start to move a booking.' });

export async function updateWalkin(ownerId: string, id: string, e: z.infer<typeof walkinEditInput>) {
  const b = await getBooking(ownerId, id);
  if (b.source !== 'walkin') throw new ApiError('forbidden', 'Only bookings you added can be edited. App bookings can only be cancelled.');
  if (b.status === 'cancelled') throw new ApiError('conflict', 'This booking was cancelled.');
  const moving = e.day !== undefined && (e.day !== b.day || e.start !== b.start);
  if (moving && b.status === 'checked_in') throw new ApiError('conflict', 'This booking is checked in, so its time can’t change.');

  const v = await getOwnedVenueRow(ownerId, b.venue.id);
  let slot: { start: number; end: number; from: Date; to: Date } | null = null;
  if (moving) {
    const today = dhakaToday();
    if (e.day! < addDays(today, -7) || e.day! > addDays(today, config.BOOKING_HORIZON_DAYS))
      throw new ApiError('invalid', 'Pick a date within the booking window.');
    const s = sessionsFor(slotRules(v), e.day!).find((x) => x.start === e.start);
    if (!s) throw new ApiError('invalid', 'That session does not exist on that day. Reload and pick again.');
    slot = { start: s.start, end: s.end, from: instant(e.day!, s.start), to: instant(e.day!, s.end) };
  }

  await tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`pitch:${v.pitch_id}`]);
    if (slot) {
      await c.query(
        "update bookings set status = 'expired' where pitch_id = $1 and status = 'held' and hold_expires_at < now() and during && tstzrange($2, $3)",
        [v.pitch_id, slot.from, slot.to],
      );
      const blocked = await c.query('select 1 from venue_blocks where pitch_id = $1 and during && tstzrange($2, $3) limit 1', [
        v.pitch_id,
        slot.from,
        slot.to,
      ]);
      if (blocked.rowCount) throw new ApiError('slot_taken', 'That time is closed. Remove the closure first.');
    }
    const amount = e.amount === undefined ? null : Math.round(e.amount * 100);
    try {
      const r = await c.query(
        `update bookings b set
            guest_name  = coalesce($3, guest_name),
            guest_phone = case when $4::boolean then nullif($5, '') else guest_phone end,
            note        = case when $6::boolean then nullif($7, '') else note end,
            total       = coalesce($8::int, total),
            price_lines = case when $8::int is null then price_lines else jsonb_build_array(jsonb_build_object('label', 'Walk-in booking', 'amount', $8::int)) end,
            day         = coalesce($9::date, day),
            start_min   = coalesce($10::int, start_min),
            end_min     = coalesce($11::int, end_min),
            during      = case when $12::timestamptz is null then during else tstzrange($12, $13) end
          from venues v
         where v.id = b.venue_id and v.owner_id = $2 and b.id = $1 and b.source = 'walkin' and b.status <> 'cancelled'`,
        [
          id,
          ownerId,
          e.guestName ?? null,
          e.guestPhone !== undefined,
          e.guestPhone ?? null,
          e.note !== undefined,
          e.note ?? null,
          amount,
          slot ? e.day : null,
          slot?.start ?? null,
          slot?.end ?? null,
          slot?.from ?? null,
          slot?.to ?? null,
        ],
      );
      if (!r.rowCount) throw new ApiError('conflict', 'This booking can no longer be edited.');
    } catch (err) {
      if ((err as { code?: string }).code === '23P01') throw new ApiError('slot_taken', 'That time is already booked. Pick another session.');
      throw err;
    }
    await audit(c, ownerId, 'booking.walkin_edit', 'booking', id, {
      before: { name: b.customer.name, day: b.day, start: b.start, amount: b.amount },
      changes: e,
    });
  });
  return getBooking(ownerId, id);
}

// ── Cancel / check in ────────────────────────────────────────────────────────────────────

export async function cancelBooking(ownerId: string, id: string, reason: string) {
  const b = await getBooking(ownerId, id);
  if (b.status !== 'confirmed')
    throw new ApiError('conflict', b.status === 'cancelled' ? 'Already cancelled.' : 'Only upcoming bookings can be cancelled.');
  // An app ticket of back-to-back slots is cancelled as a whole, like a player cancel.
  const ids = b.customer.guest ? [id] : await ticketBookingIds(id);
  const res = await tx(async (c) => {
    const done = await c.query<{ id: string; user_id: string | null; venue_id: string; day: string }>(
      `update bookings b set status = 'cancelled', cancelled_at = now()
         from venues v where v.id = b.venue_id and v.owner_id = $2 and b.id = any($1::uuid[]) and b.status = 'confirmed'
       returning b.id, b.user_id, b.venue_id, b.day::text`,
      [ids, ownerId],
    );
    if (!done.rowCount) throw new ApiError('conflict', 'This booking can no longer be cancelled.');
    // Paid in the app: the player gets a full refund (payments marks it; reconcile/finance pays it out).
    await c.query(
      "update payments set status = 'refund_required', updated_at = now() where booking_id = any($1::uuid[]) and status = 'completed'",
      [ids],
    );
    const user = done.rows.find((r) => r.user_id)?.user_id;
    if (user)
      await c.query("insert into notifications (user_id, kind, title, body) values ($1, 'booking', 'Booking cancelled by the turf', $2)", [
        user,
        `${b.venue.name} cancelled your booking ${b.code}${reason ? `: ${reason}` : '.'} A full refund is on its way.`,
      ]);
    for (const r of done.rows) await audit(c, ownerId, 'booking.owner_cancel', 'booking', r.id, { reason });
    return done.rows;
  });
  if (!b.customer.guest) for (const r of res) await onBookingCancelled(r.id);
  return getBooking(ownerId, id);
}

export async function checkIn(ownerId: string, id: string) {
  const b = await getBooking(ownerId, id);
  if (b.status === 'checked_in') throw new ApiError('conflict', 'Already checked in.');
  if (b.status !== 'confirmed' && b.status !== 'completed') throw new ApiError('conflict', 'This booking is cancelled.');
  const ids = b.customer.guest ? [id] : await ticketBookingIds(id);
  await tx(async (c) => {
    await c.query(
      `update bookings b set status = 'checked_in', checked_in_at = now() from venues v
        where v.id = b.venue_id and v.owner_id = $2 and b.id = any($1::uuid[]) and b.status = 'confirmed'`,
      [ids, ownerId],
    );
    await audit(c, ownerId, 'booking.check_in', 'booking', id);
  });
  return getBooking(ownerId, id);
}

// ── Closures (blocks) ────────────────────────────────────────────────────────────────────

export const blockInput = z.object({
  venueId: z.string().max(60),
  from: dayKey,
  /** Last day (inclusive); left out = one day. */
  to: dayKey.optional(),
  /** Left out = the whole day (opening to closing). Times before opening are after midnight. */
  start: hhmm.optional(),
  end: hhmm.optional(),
  kind: z.enum(['closed', 'maintenance', 'event', 'private']).default('closed'),
  reason: z.string().trim().max(200).optional(),
});

/** [start, end) minutes for a closure on a venue day. */
function closureMinutes(v: VenueRow, start?: string, end?: string) {
  if (!start || !end) return { s: v.open_min, e: v.close_min };
  let s = toMin(start);
  if (s < v.open_min % 1440 && v.close_min > 1440) s += 1440;
  let e = toMin(end);
  while (e <= s) e += 1440;
  return { s, e };
}

/** Rejects closures that would hit live bookings; returns the conflicts' codes. */
async function assertFree(c: PoolClient, pitchId: string, ranges: { from: Date; to: Date }[]) {
  const hits: string[] = [];
  for (const r of ranges) {
    const x = await c.query<{ code: string }>(
      `select code from bookings where pitch_id = $1 and during && tstzrange($2, $3) and status in ${ACTIVE}
         and not (status in ('held','pending') and hold_expires_at < now()) limit 5`,
      [pitchId, r.from, r.to],
    );
    hits.push(...x.rows.map((y) => y.code));
  }
  if (hits.length)
    throw new ApiError(
      'conflict',
      `There are bookings in that time (${[...new Set(hits)].slice(0, 5).join(', ')}). Cancel or move them first.`,
    );
}

export async function createBlocks(ownerId: string, b: z.infer<typeof blockInput>, tournamentId?: string, client?: PoolClient) {
  const v = await getOwnedVenueRow(ownerId, b.venueId);
  const last = b.to ?? b.from;
  const n = daysBetween(b.from, last);
  if (n > 92) throw new ApiError('invalid', 'Close at most 92 days at a time.');
  const { s, e } = closureMinutes(v, b.start, b.end);
  const ranges = Array.from({ length: n }, (_, i) => addDays(b.from, i)).map((d) => ({ from: instant(d, s), to: instant(d, e) }));
  const run = async (c: PoolClient) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`pitch:${v.pitch_id}`]);
    await assertFree(c, v.pitch_id, ranges);
    for (const r of ranges)
      await c.query(
        'insert into venue_blocks (pitch_id, during, reason, kind, created_by, tournament_id) values ($1, tstzrange($2, $3), $4, $5, $6, $7)',
        [v.pitch_id, r.from, r.to, b.reason || null, tournamentId ? 'tournament' : b.kind, ownerId, tournamentId ?? null],
      );
    await audit(c, ownerId, 'block.create', 'venue', v.id, { from: b.from, to: last, start: s, end: e, kind: b.kind, tournamentId });
  };
  if (client) await run(client);
  else await tx(run);
  return { ok: true, count: ranges.length };
}

export async function listBlocks(ownerId: string, venueId: string, from: string, to: string) {
  const v = await getOwnedVenueRow(ownerId, venueId);
  daysBetween(from, to);
  const rows = await q<{
    id: string;
    s: Date;
    e: Date;
    reason: string | null;
    kind: string;
    tournament_id: string | null;
    created_at: Date;
  }>(
    `select id, lower(during) s, upper(during) e, reason, kind, tournament_id, created_at from venue_blocks
      where pitch_id = $1 and during && tstzrange($2, $3) order by lower(during)`,
    [v.pitch_id, instant(from, 0), instant(addDays(to, 1), 0)],
  );
  return rows.map((r) => {
    // Back to venue-day minutes (a block after midnight belongs to the day it started on the venue's clock).
    const dayStart = Date.parse(`${new Date(r.s.getTime() + 6 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`) - 6 * 3600_000;
    let day = new Date(dayStart + 6 * 3600_000).toISOString().slice(0, 10);
    let start = Math.round((r.s.getTime() - dayStart) / 60_000);
    if (start < v.open_min % 1440 && v.close_min > 1440 && start + 1440 < v.close_min) {
      day = addDays(day, -1);
      start += 1440;
    }
    return {
      id: r.id,
      day,
      start,
      end: start + Math.round((r.e.getTime() - r.s.getTime()) / 60_000),
      reason: r.reason,
      kind: r.kind,
      tournamentId: r.tournament_id,
      createdAt: r.created_at,
    };
  });
}

export async function deleteBlock(ownerId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'Closure not found.');
  const r = await one<{ id: string }>(
    `delete from venue_blocks k using pitches p, venues v
      where k.id = $1 and p.id = k.pitch_id and v.id = p.venue_id and v.owner_id = $2 returning k.id`,
    [id, ownerId],
  );
  if (!r) throw new ApiError('not_found', 'Closure not found.');
  await audit(null, ownerId, 'block.delete', 'venue_block', id);
  return { ok: true };
}

// ── Stats (overview) ─────────────────────────────────────────────────────────────────────

export const statsQuery = z.object({ venueId: z.string().max(60).optional(), from: dayKey, to: dayKey });

export async function stats(ownerId: string, f: z.infer<typeof statsQuery>) {
  const venues = await venueScope(ownerId, f.venueId);
  const n = daysBetween(f.from, f.to);
  const prevTo = addDays(f.from, -1);
  const prevFrom = addDays(f.from, -n);
  const monthly = n > 62;
  const bucket = monthly ? "to_char(day, 'YYYY-MM')" : 'day::text';

  type Tot = {
    revenue: string;
    app_revenue: string;
    walkin_revenue: string;
    bookings: number;
    minutes: number;
    cancelled: number;
    players: number;
    walkins: number;
  };
  const totals = (a: string, b: string) =>
    one<Tot>(
      `select coalesce(sum(total) filter (where status in ${PAID}), 0) revenue,
              coalesce(sum(total) filter (where status in ${PAID} and source <> 'walkin'), 0) app_revenue,
              coalesce(sum(total) filter (where status in ${PAID} and source = 'walkin'), 0) walkin_revenue,
              count(*) filter (where status in ${PAID})::int bookings,
              coalesce(sum(end_min - start_min) filter (where status in ${PAID}), 0)::int minutes,
              count(*) filter (where status = 'cancelled')::int cancelled,
              count(distinct user_id) filter (where status in ${PAID})::int players,
              count(*) filter (where status in ${PAID} and source = 'walkin')::int walkins
         from bookings where venue_id = any($1::text[]) and day between $2::date and $3::date`,
      [venues, a, b],
    );

  const [cur, prev, series, byHour, byWeekday, perVenue, ratings, schedules] = await Promise.all([
    totals(f.from, f.to),
    totals(prevFrom, prevTo),
    q<{ k: string; revenue: string; walkin: string; bookings: number }>(
      `select ${bucket} k, coalesce(sum(total), 0) revenue, coalesce(sum(total) filter (where source = 'walkin'), 0) walkin, count(*)::int bookings
         from bookings where venue_id = any($1::text[]) and day between $2::date and $3::date and status in ${PAID}
        group by 1 order by 1`,
      [venues, f.from, f.to],
    ),
    q<{ h: number; n: number }>(
      `select ((start_min / 60) % 24)::int h, count(*)::int n from bookings
        where venue_id = any($1::text[]) and day between $2::date and $3::date and status in ${PAID} group by 1 order by 1`,
      [venues, f.from, f.to],
    ),
    q<{ d: number; n: number; revenue: string }>(
      `select extract(dow from day)::int d, count(*)::int n, coalesce(sum(total), 0) revenue from bookings
        where venue_id = any($1::text[]) and day between $2::date and $3::date and status in ${PAID} group by 1 order by 1`,
      [venues, f.from, f.to],
    ),
    q<{ id: string; name: string; revenue: string; bookings: number }>(
      `select v.id, v.name, coalesce(sum(b.total) filter (where b.status in ${PAID}), 0) revenue, count(b.id) filter (where b.status in ${PAID})::int bookings
         from venues v left join bookings b on b.venue_id = v.id and b.day between $2::date and $3::date
        where v.id = any($1::text[]) group by v.id, v.name order by 3 desc`,
      [venues, f.from, f.to],
    ),
    one<{ rating: string | null; reviews: number }>(
      `select round(avg(rating)::numeric, 1)::text rating, count(*)::int reviews from reviews where venue_id = any($1::text[])`,
      [venues],
    ),
    q<{
      open_min: number;
      close_min: number;
      session_min: number;
      break_min: number;
      slot_mode: string;
      custom_slots: { start: number; end: number }[] | null;
      slot_sets: SessionSetRow[] | null;
    }>('select open_min, close_min, session_min, break_min, slot_mode, custom_slots, slot_sets from venue_schedule where venue_id = any($1::text[])', [
      venues,
    ]),
  ]);

  // Fill the series so the chart has every day/month, with zero where nothing happened.
  const keys: string[] = [];
  if (monthly) {
    for (let d = f.from.slice(0, 7); d <= f.to.slice(0, 7);) {
      keys.push(d);
      const [y, m] = d.split('-').map(Number) as [number, number];
      d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  } else for (let i = 0; i < n; i++) keys.push(addDays(f.from, i));
  const byKey = new Map(series.map((s) => [s.k, s]));

  // Occupancy: booked minutes ÷ minutes on sale in the period, counted day by day (session sets can
  // differ by weekday). Uses today's schedule for every day, including past ones.
  const capacity = (a: string, days: number) =>
    schedules.reduce((m, s) => {
      const r = {
        openMin: s.open_min,
        closeMin: s.close_min,
        lengthMin: s.session_min,
        breakMin: s.break_min,
        mode: s.slot_mode,
        custom: s.custom_slots,
        sets: s.slot_sets,
      };
      let t = 0;
      for (let i = 0; i < days; i++) t += sessionsFor(r, addDays(a, i)).reduce((u, x) => u + (x.end - x.start), 0);
      return m + t;
    }, 0);
  const capCur = capacity(f.from, n);
  const capPrev = capacity(prevFrom, n);
  const shape = (t: Tot | null, cap: number) => ({
    revenue: taka(t?.revenue),
    appRevenue: taka(t?.app_revenue),
    walkinRevenue: taka(t?.walkin_revenue),
    bookings: t?.bookings ?? 0,
    hours: Math.round(((t?.minutes ?? 0) / 60) * 10) / 10,
    cancelled: t?.cancelled ?? 0,
    players: t?.players ?? 0,
    walkins: t?.walkins ?? 0,
    occupancy: cap ? Math.min(100, Math.round(((t?.minutes ?? 0) / cap) * 1000) / 10) : 0,
  });
  return {
    range: { from: f.from, to: f.to, days: n, bucket: monthly ? ('month' as const) : ('day' as const) },
    current: shape(cur, capCur),
    previous: { from: prevFrom, to: prevTo, ...shape(prev, capPrev) },
    series: keys.map((k) => ({
      key: k,
      revenue: taka(byKey.get(k)?.revenue),
      walkinRevenue: taka(byKey.get(k)?.walkin),
      bookings: byKey.get(k)?.bookings ?? 0,
    })),
    byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, bookings: byHour.find((x) => x.h === h)?.n ?? 0 })),
    byWeekday: Array.from({ length: 7 }, (_, d) => ({
      day: d,
      bookings: byWeekday.find((x) => x.d === d)?.n ?? 0,
      revenue: taka(byWeekday.find((x) => x.d === d)?.revenue),
    })),
    venues: perVenue.map((v) => ({ id: v.id, name: v.name, revenue: taka(v.revenue), bookings: v.bookings })),
    rating: ratings?.rating ? Number(ratings.rating) : null,
    reviews: ratings?.reviews ?? 0,
  };
}

/** Days with bookings in a month (for the calendar's dots), plus each day's revenue. */
export async function calendar(ownerId: string, venueId: string | undefined, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError('invalid', 'Use a month like 2026-12.');
  const venues = await venueScope(ownerId, venueId);
  const rows = await q<{ dk: string; bookings: number; revenue: string }>(
    `select d::date::text as dk,
            (select count(*)::int from bookings b where b.venue_id = any($1::text[]) and b.day = d::date and b.status in ${PAID}) bookings,
            (select coalesce(sum(total), 0) from bookings b where b.venue_id = any($1::text[]) and b.day = d::date and b.status in ${PAID}) revenue
       from generate_series($2::date, ($2::date + interval '1 month' - interval '1 day'), interval '1 day') d`,
    [venues, `${month}-01`],
  );
  return rows.map((r) => ({ day: r.dk, bookings: r.bookings, revenue: taka(r.revenue) }));
}

// ── Reviews ──────────────────────────────────────────────────────────────────────────────

export async function listReviews(ownerId: string, venueId: string | undefined, cursor: number) {
  const venues = await venueScope(ownerId, venueId);
  const rows = await q<{
    id: string;
    venue_id: string;
    venue_name: string;
    author_name: string;
    rating: number;
    body: string;
    created_at: Date;
  }>(
    `select r.id, r.venue_id, v.name venue_name, r.author_name, r.rating, r.body, r.created_at
       from reviews r join venues v on v.id = r.venue_id where r.venue_id = any($1::text[])
      order by r.created_at desc offset $2 limit 31`,
    [venues, cursor],
  );
  const dist = await q<{ rating: number; n: number }>(
    'select rating, count(*)::int n from reviews where venue_id = any($1::text[]) group by 1',
    [venues],
  );
  return {
    items: rows.slice(0, 30).map((r) => ({
      id: r.id,
      venue: { id: r.venue_id, name: r.venue_name },
      author: r.author_name,
      rating: r.rating,
      body: r.body,
      createdAt: r.created_at,
    })),
    distribution: [5, 4, 3, 2, 1].map((s) => ({ rating: s, count: dist.find((d) => d.rating === s)?.n ?? 0 })),
    nextCursor: rows.length > 30 ? cursor + 30 : null,
  };
}

// ── Tournaments ──────────────────────────────────────────────────────────────────────────

export const tournamentInput = z
  .object({
    venueId: z.string().max(60),
    title: z.string().trim().min(3).max(100),
    sport: z.enum(['football', 'cricket']).default('football'),
    format: z.string().trim().min(2).max(40).default('5-a-side'),
    description: z.string().trim().max(3000).default(''),
    terms: z.string().trim().max(5000).default(''),
    prizes: z.string().trim().max(1000).default(''),
    entryFee: z.number().int().min(0).max(1_000_000).default(0),
    maxTeams: z.number().int().min(2).max(128).default(8),
    teamSize: z.number().int().min(1).max(30).default(7),
    startsOn: dayKey,
    endsOn: dayKey,
    startTime: hhmm,
    endTime: hhmm,
    registrationCloses: dayKey.nullable().optional(),
    contactPhone: z.string().trim().max(20).optional(),
    coverUrl: z.string().url().max(500).nullable().optional(),
    /** Close the turf for bookings during the tournament hours (published tournaments only). */
    blockTurf: z.boolean().default(true),
    status: z.enum(['draft', 'published', 'closed', 'completed', 'cancelled']).default('draft'),
  })
  .refine((t) => t.endsOn >= t.startsOn, { message: 'The last day must be on or after the first day.', path: ['endsOn'] })
  .refine((t) => !t.registrationCloses || t.registrationCloses <= t.endsOn, {
    message: 'Registration must close before the tournament ends.',
    path: ['registrationCloses'],
  });
export type TournamentInput = z.infer<typeof tournamentInput>;

type TRow = {
  id: string;
  venue_id: string;
  venue_name: string;
  title: string;
  sport: string;
  format: string;
  description: string;
  terms: string;
  prizes: string;
  entry_fee: string;
  max_teams: number;
  team_size: number;
  starts_on: string;
  ends_on: string;
  start_min: number;
  end_min: number;
  registration_closes: string | null;
  contact_phone: string | null;
  cover_url: string | null;
  block_turf: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  teams: number;
  paid_teams: number;
};
const T_SELECT = `select t.id, t.venue_id, v.name venue_name, t.title, t.sport, t.format, t.description, t.terms, t.prizes, t.entry_fee, t.max_teams,
    t.team_size, t.starts_on::text, t.ends_on::text, t.start_min, t.end_min, t.registration_closes::text, t.contact_phone, t.cover_url, t.block_turf,
    t.status, t.created_at, t.updated_at,
    (select count(*)::int from tournament_teams x where x.tournament_id = t.id) teams,
    (select count(*)::int from tournament_teams x where x.tournament_id = t.id and x.paid) paid_teams
  from tournaments t join venues v on v.id = t.venue_id`;
const fromMin = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tOut = (t: TRow) => ({
  id: t.id,
  venue: { id: t.venue_id, name: t.venue_name },
  title: t.title,
  sport: t.sport,
  format: t.format,
  description: t.description,
  terms: t.terms,
  prizes: t.prizes,
  entryFee: taka(t.entry_fee),
  maxTeams: t.max_teams,
  teamSize: t.team_size,
  startsOn: t.starts_on,
  endsOn: t.ends_on,
  startTime: fromMin(t.start_min),
  endTime: fromMin(t.end_min),
  registrationCloses: t.registration_closes,
  contactPhone: t.contact_phone,
  coverUrl: t.cover_url ? photoUrl(t.cover_url) : null,
  blockTurf: t.block_turf,
  status: t.status,
  teams: t.teams,
  paidTeams: t.paid_teams,
  collected: taka(Number(t.entry_fee) * t.paid_teams),
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

export async function listTournaments(ownerId: string, venueId?: string) {
  const venues = await venueScope(ownerId, venueId);
  return (
    await q<TRow>(`${T_SELECT} where t.venue_id = any($1::text[]) order by t.starts_on desc, t.created_at desc limit 200`, [venues])
  ).map(tOut);
}

async function getT(ownerId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'Tournament not found.');
  const t = await one<TRow>(`${T_SELECT} where t.id = $1 and v.owner_id = $2`, [id, ownerId]);
  if (!t) throw new ApiError('not_found', 'Tournament not found.');
  return t;
}

export async function getTournament(ownerId: string, id: string) {
  const t = await getT(ownerId, id);
  const teams = await q<{
    id: string;
    name: string;
    captain_name: string;
    captain_phone: string;
    players: number;
    paid: boolean;
    note: string | null;
    created_at: Date;
  }>(
    'select id, name, captain_name, captain_phone, players, paid, note, created_at from tournament_teams where tournament_id = $1 order by created_at',
    [id],
  );
  return {
    ...tOut(t),
    teamList: teams.map((x) => ({
      id: x.id,
      name: x.name,
      captainName: x.captain_name,
      captainPhone: x.captain_phone,
      players: x.players,
      paid: x.paid,
      note: x.note,
      createdAt: x.created_at,
    })),
  };
}

function tMinutes(v: VenueRow, t: TournamentInput) {
  let s = toMin(t.startTime);
  if (s < v.open_min % 1440 && v.close_min > 1440) s += 1440;
  let e = toMin(t.endTime);
  while (e <= s) e += 1440;
  if (s > 1439) {
    // stored start must be on the day itself
    s -= 1440;
    e -= 1440;
  }
  if (e - s > 1440) throw new ApiError('invalid', 'endTime: A tournament day can be at most 24 hours.');
  return { s, e };
}

/** Published (or closed for entries) tournaments that close the turf keep their blocks in step. */
async function syncBlocks(c: PoolClient, ownerId: string, id: string, v: VenueRow, t: TournamentInput) {
  await c.query('delete from venue_blocks where tournament_id = $1', [id]);
  if (!t.blockTurf || !['published', 'closed'].includes(t.status)) return;
  const { s, e } = tMinutes(v, t);
  await createBlocks(
    ownerId,
    { venueId: v.id, from: t.startsOn, to: t.endsOn, start: fromMin(s), end: fromMin(e), kind: 'event', reason: `Tournament: ${t.title}` },
    id,
    c,
  );
}

export async function saveTournament(ownerId: string, t: TournamentInput, id?: string) {
  const v = await getOwnedVenueRow(ownerId, t.venueId);
  daysBetween(t.startsOn, t.endsOn);
  const { s, e } = tMinutes(v, t);
  const vals = [
    v.id,
    t.title,
    t.sport,
    t.format,
    t.description,
    t.terms,
    t.prizes,
    t.entryFee * 100,
    t.maxTeams,
    t.teamSize,
    t.startsOn,
    t.endsOn,
    s,
    e,
    t.registrationCloses ?? null,
    t.contactPhone || null,
    t.coverUrl ?? null,
    t.blockTurf,
    t.status,
  ];
  const tid = await tx(async (c) => {
    let tid = id;
    if (tid) {
      await getT(ownerId, tid);
      await c.query(
        `update tournaments set venue_id=$1, title=$2, sport=$3, format=$4, description=$5, terms=$6, prizes=$7, entry_fee=$8, max_teams=$9, team_size=$10,
                starts_on=$11, ends_on=$12, start_min=$13, end_min=$14, registration_closes=$15, contact_phone=$16, cover_url=$17, block_turf=$18, status=$19,
                updated_at=now() where id = $20`,
        [...vals, tid],
      );
    } else {
      const count = (
        await c.query<{ n: number }>(
          "select count(*)::int n from tournaments where venue_id = $1 and status in ('draft','published','closed')",
          [v.id],
        )
      ).rows[0]!.n;
      if (count >= 50) throw new ApiError('conflict', 'This turf already has 50 open tournaments.');
      tid = (
        await c.query<{ id: string }>(
          `insert into tournaments (venue_id, title, sport, format, description, terms, prizes, entry_fee, max_teams, team_size, starts_on, ends_on,
                                    start_min, end_min, registration_closes, contact_phone, cover_url, block_turf, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
          vals,
        )
      ).rows[0]!.id;
    }
    await syncBlocks(c, ownerId, tid, v, t);
    await audit(c, ownerId, id ? 'tournament.update' : 'tournament.create', 'tournament', tid, { status: t.status });
    return tid;
  });
  return getTournament(ownerId, tid);
}

export async function deleteTournament(ownerId: string, id: string) {
  const t = await getT(ownerId, id);
  if (t.paid_teams > 0) throw new ApiError('conflict', 'Teams have paid for this tournament. Cancel it instead, and refund them.');
  await tx(async (c) => {
    await c.query('delete from tournaments where id = $1', [id]); // its blocks and teams go with it
    await audit(c, ownerId, 'tournament.delete', 'tournament', id, { title: t.title });
  });
  return { ok: true };
}

export const teamInput = z.object({
  name: z.string().trim().min(2).max(60),
  captainName: z.string().trim().min(2).max(80),
  captainPhone: z.string().trim().min(6).max(20),
  players: z.number().int().min(0).max(40).default(0),
  paid: z.boolean().default(false),
  note: z.string().trim().max(300).optional(),
});

export async function saveTeam(ownerId: string, tournamentId: string, b: z.infer<typeof teamInput>, teamId?: string) {
  const t = await getT(ownerId, tournamentId);
  await tx(async (c) => {
    if (teamId) {
      const r = await c.query(
        'update tournament_teams set name=$3, captain_name=$4, captain_phone=$5, players=$6, paid=$7, note=$8 where id = $1 and tournament_id = $2',
        [teamId, tournamentId, b.name, b.captainName, b.captainPhone, b.players, b.paid, b.note || null],
      );
      if (!r.rowCount) throw new ApiError('not_found', 'Team not found.');
    } else {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`tournament:${tournamentId}`]);
      const n = (await c.query<{ n: number }>('select count(*)::int n from tournament_teams where tournament_id = $1', [tournamentId]))
        .rows[0]!.n;
      if (n >= t.max_teams) throw new ApiError('conflict', `The tournament is full (${t.max_teams} teams).`);
      await c.query(
        'insert into tournament_teams (tournament_id, name, captain_name, captain_phone, players, paid, note) values ($1,$2,$3,$4,$5,$6,$7)',
        [tournamentId, b.name, b.captainName, b.captainPhone, b.players, b.paid, b.note || null],
      );
    }
    await audit(c, ownerId, teamId ? 'tournament.team_update' : 'tournament.team_add', 'tournament', tournamentId, {
      team: b.name,
      paid: b.paid,
    });
  });
  return getTournament(ownerId, tournamentId);
}

export async function deleteTeam(ownerId: string, tournamentId: string, teamId: string) {
  await getT(ownerId, tournamentId);
  if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw new ApiError('not_found', 'Team not found.');
  const r = await one('delete from tournament_teams where id = $1 and tournament_id = $2 returning id', [teamId, tournamentId]);
  if (!r) throw new ApiError('not_found', 'Team not found.');
  await audit(null, ownerId, 'tournament.team_delete', 'tournament', tournamentId, { teamId });
  return getTournament(ownerId, tournamentId);
}

/** Public (players): upcoming published tournaments at a turf. */
export async function publicTournaments(venueId: string) {
  const rows = await q<TRow>(
    `${T_SELECT} where t.venue_id = $1 and v.status = 'published' and t.status in ('published','closed') and t.ends_on >= $2::date order by t.starts_on limit 20`,
    [venueId, dhakaToday()],
  );
  return rows.map((t) => {
    const o = tOut(t);
    return {
      id: o.id,
      title: o.title,
      sport: o.sport,
      format: o.format,
      description: o.description,
      terms: o.terms,
      prizes: o.prizes,
      entryFee: Number(t.entry_fee), // poisha, like the rest of the player API
      maxTeams: o.maxTeams,
      teamSize: o.teamSize,
      teams: o.teams,
      startsOn: o.startsOn,
      endsOn: o.endsOn,
      start: t.start_min,
      end: t.end_min,
      registrationCloses: o.registrationCloses,
      registrationOpen: t.status === 'published' && o.teams < o.maxTeams && (!o.registrationCloses || o.registrationCloses >= dhakaToday()),
      contactPhone: o.contactPhone,
      coverUrl: o.coverUrl,
    };
  });
}

// ── Notifications (owner inbox) ──────────────────────────────────────────────────────────

export async function notifications(ownerId: string, limit = 40) {
  const venues = await venueScope(ownerId);
  const seen = (await one<{ seen_at: Date }>('select seen_at from owner_inbox where user_id = $1', [ownerId]))?.seen_at ?? new Date(0);
  const rows = await q<{
    id: string;
    kind: string;
    at: Date;
    venue_id: string;
    venue_name: string;
    title: string;
    body: string;
    ref: string | null;
  }>(
    `select * from (
       select 'b:' || b.id id, 'booking' kind, b.confirmed_at at, b.venue_id, v.name venue_name,
              'New booking' title,
              coalesce(u.name, b.guest_name, 'A player') || ' booked ' || to_char(b.day, 'Dy DD Mon') || ' · ' ||
                lpad(((b.start_min / 60) % 24)::text, 2, '0') || ':' || lpad((b.start_min % 60)::text, 2, '0') ||
                ' (৳' || to_char(b.total / 100.0, 'FM999,999,990') || ')' body, b.id::text ref
         from bookings b join venues v on v.id = b.venue_id left join users u on u.id = b.user_id
        where b.venue_id = any($1::text[]) and b.confirmed_at is not null and b.source <> 'walkin' and b.confirmed_at > now() - interval '30 days'
       union all
       select 'c:' || b.id, 'cancel', b.cancelled_at, b.venue_id, v.name, 'Booking cancelled',
              coalesce(u.name, b.guest_name, 'A player') || ' · ' || b.code || ' on ' || to_char(b.day, 'Dy DD Mon'), b.id::text
         from bookings b join venues v on v.id = b.venue_id left join users u on u.id = b.user_id
        where b.venue_id = any($1::text[]) and b.status = 'cancelled' and b.cancelled_at > now() - interval '30 days'
       union all
       select 'r:' || r.id, 'review', r.created_at, r.venue_id, v.name, 'New ' || r.rating || '★ review',
              r.author_name || coalesce(': ' || nullif(left(r.body, 120), ''), ''), r.id::text
         from reviews r join venues v on v.id = r.venue_id
        where r.venue_id = any($1::text[]) and r.created_at > now() - interval '30 days'
       union all
       select 't:' || x.id, 'tournament', x.created_at, t.venue_id, v.name, 'Team registered',
              x.name || ' joined ' || t.title, t.id::text
         from tournament_teams x join tournaments t on t.id = x.tournament_id join venues v on v.id = t.venue_id
        where t.venue_id = any($1::text[]) and x.created_at > now() - interval '30 days'
     ) n order by at desc limit $2`,
    [venues, limit],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      at: r.at,
      venue: { id: r.venue_id, name: r.venue_name },
      title: r.title,
      body: r.body,
      ref: r.ref,
      unread: r.at > seen,
    })),
    unread: rows.filter((r) => r.at > seen).length,
    seenAt: seen,
  };
}

export async function markNotificationsSeen(ownerId: string) {
  await q('insert into owner_inbox (user_id, seen_at) values ($1, now()) on conflict (user_id) do update set seen_at = now()', [ownerId]);
  return { ok: true };
}
