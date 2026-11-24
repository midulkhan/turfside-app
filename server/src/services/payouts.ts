/**
 * Turf owners' earnings and payouts (migration 030).
 *
 * Money here is always integer poisha (1 taka = 100 poisha): amounts in the API responses are
 * poisha too, so nothing is ever rounded twice. ৳2,500 booking at 2.15% → gross 250000,
 * commission 5375, net 244625 (৳2,446.25).
 *
 * Where the numbers come from:
 *  - owner_earnings: a 'sale' row per app booking when it's paid and confirmed, a 'reversal'
 *    (the same amounts, negative) if it's cancelled. Written by a database trigger on bookings.
 *  - payouts: what TurfSides has paid the owner. A payout takes every unpaid earning recorded
 *    before its cutoff (normally the last Dhaka midnight) and marks them with its id.
 *  - pending = the sum of earnings with no payout yet. That's exactly what the next payout
 *    pays (if it's above zero; a negative balance, from refunds after a payout, carries over).
 *
 * Admin functions (the TurfSides business dashboard) are at the bottom; they're reached through
 * /v1/admin/* with the ADMIN_API_KEY.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, instant } from '../lib/time';

// ── Shared ───────────────────────────────────────────────────────────────────────────────

const n = (x: string | number | null | undefined) => Number(x ?? 0); // pg returns bigint/sum as strings
const DAY_MS = 86400_000;

/** The Dhaka midnight that starts today (the default payout cutoff), and the next one. */
export const lastMidnight = (now = Date.now()) => instant(dhakaToday(now), 0);
export const nextMidnight = (now = Date.now()) => instant(addDays(dhakaToday(now), 1), 0);

/** Commission in poisha, rounded half up: the same formula as the database trigger. */
export const commissionOf = (gross: number, rateBp: number) => Math.floor((gross * rateBp + 5000) / 10000);

/** The commission rate (basis points) that applies to an owner now. */
export async function currentRate(ownerId: string | null) {
  return n((await one<{ bp: number }>('select commission_bp($1, now()) bp', [ownerId]))?.bp);
}

type Balance = { pending: number; pendingEntries: number; paid: number; payouts: number };
async function balanceOf(ownerId: string): Promise<Balance> {
  const r = await one<{ pending: string; pending_entries: string; paid: string; payouts: string }>(
    `select (select coalesce(sum(net), 0) from owner_earnings where owner_id = $1 and payout_id is null) pending,
            (select count(*) from owner_earnings where owner_id = $1 and payout_id is null) pending_entries,
            (select coalesce(sum(amount), 0) from payouts where owner_id = $1 and status = 'paid') paid,
            (select count(*) from payouts where owner_id = $1 and status = 'paid') payouts`,
    [ownerId],
  );
  return { pending: n(r?.pending), pendingEntries: n(r?.pending_entries), paid: n(r?.paid), payouts: n(r?.payouts) };
}

type PayoutRow = {
  id: string;
  owner_id: string;
  cutoff: Date;
  gross: string;
  commission: string;
  amount: string;
  entries: number;
  status: string;
  method: string;
  reference: string | null;
  note: string | null;
  paid_at: Date;
  created_by: string;
  voided_at: Date | null;
  void_reason: string | null;
};
const payoutOut = (p: PayoutRow) => ({
  id: p.id,
  ownerId: p.owner_id,
  status: p.status as 'paid' | 'void',
  amount: n(p.amount),
  gross: n(p.gross),
  commission: n(p.commission),
  bookings: p.entries,
  cutoff: p.cutoff,
  paidAt: p.paid_at,
  method: p.method,
  reference: p.reference,
  note: p.note,
  voidedAt: p.voided_at,
  voidReason: p.void_reason,
});
const PAYOUT_COLS = 'id, owner_id, cutoff, gross, commission, amount, entries, status, method, reference, note, paid_at, created_by, voided_at, void_reason';

type EntryRow = {
  id: string;
  kind: 'sale' | 'reversal';
  gross: string;
  commission: string;
  net: string;
  rate_bp: number;
  occurred_at: Date;
  payout_id: string | null;
  booking_id: string;
  code: string;
  day: string;
  start_min: number;
  end_min: number;
  venue_id: string;
  venue_name: string;
  customer: string | null;
};
const ENTRY_SELECT = `
  select e.id, e.kind, e.gross, e.commission, e.net, e.rate_bp, e.occurred_at, e.payout_id, e.booking_id,
         b.code, b.day::text, b.start_min, b.end_min, e.venue_id, v.name venue_name, u.name customer
    from owner_earnings e join bookings b on b.id = e.booking_id join venues v on v.id = e.venue_id
    left join users u on u.id = b.user_id`;
const entryOut = (e: EntryRow) => ({
  id: Number(e.id),
  kind: e.kind,
  booking: { id: e.booking_id, code: e.code, day: e.day, start: e.start_min, end: e.end_min, customer: e.customer },
  venue: { id: e.venue_id, name: e.venue_name },
  gross: n(e.gross),
  commission: n(e.commission),
  net: n(e.net),
  ratePercent: e.rate_bp / 100,
  occurredAt: e.occurred_at,
  payoutId: e.payout_id,
  status: e.payout_id ? ('paid' as const) : ('pending' as const),
});

// ── Owner dashboard ──────────────────────────────────────────────────────────────────────

export const RANGES = { '24h': 1, '7d': 7, '30d': 30, '1y': 365 } as const;
export const earningsQuery = z.object({
  range: z.enum(['24h', '7d', '30d', '1y']).default('7d'),
  venueId: z.string().max(60).optional(),
});

/**
 * The overview's money card: sales, commission and earnings over the last 24 hours / 7 days /
 * 30 days / 365 days (rolling, up to now), cancellations and what they cost, walk-ins, and the
 * payout balance (paid so far, pending for the next payout). The balance is always for all the
 * owner's turfs (payouts are per owner); the rest follows `venueId`.
 */
export async function ownerEarnings(ownerId: string, f: z.infer<typeof earningsQuery>, venueIds: string[]) {
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[f.range] * DAY_MS);
  const [e] = await q<{
    sales: string;
    sales_gross: string;
    sales_commission: string;
    sales_net: string;
    rev: string;
    rev_gross: string;
    rev_commission: string;
    rev_net: string;
  }>(
    `select count(*) filter (where kind = 'sale') sales,
            coalesce(sum(gross) filter (where kind = 'sale'), 0) sales_gross,
            coalesce(sum(commission) filter (where kind = 'sale'), 0) sales_commission,
            coalesce(sum(net) filter (where kind = 'sale'), 0) sales_net,
            count(*) filter (where kind = 'reversal') rev,
            coalesce(sum(gross) filter (where kind = 'reversal'), 0) rev_gross,
            coalesce(sum(commission) filter (where kind = 'reversal'), 0) rev_commission,
            coalesce(sum(net) filter (where kind = 'reversal'), 0) rev_net
       from owner_earnings
      where owner_id = $1 and venue_id = any($2::text[]) and occurred_at >= $3 and occurred_at < $4`,
    [ownerId, venueIds, from, to],
  );
  // Walk-ins: money the turf takes itself (never through TurfSides, so no commission).
  const [w] = await q<{ made: string; made_amount: string; cancelled: string; cancelled_amount: string }>(
    `select count(*) filter (where status <> 'cancelled' and created_at >= $2 and created_at < $3) made,
            coalesce(sum(total) filter (where status <> 'cancelled' and created_at >= $2 and created_at < $3), 0) made_amount,
            count(*) filter (where status = 'cancelled' and cancelled_at >= $2 and cancelled_at < $3) cancelled,
            coalesce(sum(total) filter (where status = 'cancelled' and cancelled_at >= $2 and cancelled_at < $3), 0) cancelled_amount
       from bookings where venue_id = any($1::text[]) and source = 'walkin'`,
    [venueIds, from, to],
  );
  const bal = await balanceOf(ownerId);
  const last = await one<PayoutRow>(`select ${PAYOUT_COLS} from payouts where owner_id = $1 and status = 'paid' order by paid_at desc limit 1`, [ownerId]);
  const rateBp = await currentRate(ownerId);
  const salesNet = n(e?.sales_net);
  const revNet = n(e?.rev_net);
  return {
    unit: 'poisha' as const,
    range: f.range,
    from,
    to,
    commissionPercent: rateBp / 100,
    /** App bookings paid in this period (before any cancellations). */
    sales: { bookings: n(e?.sales), gross: n(e?.sales_gross), commission: n(e?.sales_commission), net: salesNet },
    /** App bookings cancelled (and refunded to the player) in this period: what the owner doesn't get. */
    cancelled: {
      bookings: n(e?.rev) + n(w?.cancelled),
      app: { bookings: n(e?.rev), gross: -n(e?.rev_gross), commission: -n(e?.rev_commission), net: -revNet },
      walkin: { bookings: n(w?.cancelled), amount: n(w?.cancelled_amount) },
      /** Lost: app earnings given back plus cancelled walk-ins' amounts. */
      lost: -revNet + n(w?.cancelled_amount),
    },
    /** What the owner earns from app bookings in this period: sales minus cancellations, after commission. */
    earnings: salesNet + revNet,
    walkins: { bookings: n(w?.made), amount: n(w?.made_amount) },
    balance: {
      ...bal,
      /** The next payout pays the pending balance (if above zero) at the next Dhaka midnight. */
      nextPayoutAt: nextMidnight(),
      nextPayout: Math.max(0, bal.pending),
      lastPayout: last ? payoutOut(last) : null,
    },
  };
}

export const listQuery = z.object({
  cursor: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function ownerPayouts(ownerId: string, f: z.infer<typeof listQuery>) {
  const rows = await q<PayoutRow>(`select ${PAYOUT_COLS} from payouts where owner_id = $1 order by paid_at desc, id offset $2 limit $3`, [
    ownerId,
    f.cursor,
    f.limit + 1,
  ]);
  return { unit: 'poisha' as const, items: rows.slice(0, f.limit).map(payoutOut), nextCursor: rows.length > f.limit ? f.cursor + f.limit : null };
}

export const entriesQuery = listQuery.extend({
  status: z.enum(['all', 'pending', 'paid']).default('all'),
  payoutId: z.string().uuid().optional(),
  venueId: z.string().max(60).optional(),
});

/** Booking by booking: what each paid (or gave back) and what the owner gets. */
export async function ownerEntries(ownerId: string, f: z.infer<typeof entriesQuery>) {
  const rows = await q<EntryRow>(
    `${ENTRY_SELECT}
      where e.owner_id = $1
        and ($2::text = 'all' or ($2 = 'pending' and e.payout_id is null) or ($2 = 'paid' and e.payout_id is not null))
        and ($3::uuid is null or e.payout_id = $3)
        and ($4::text is null or e.venue_id = $4)
      order by e.occurred_at desc, e.id desc offset $5 limit $6`,
    [ownerId, f.status, f.payoutId ?? null, f.venueId ?? null, f.cursor, f.limit + 1],
  );
  return { unit: 'poisha' as const, items: rows.slice(0, f.limit).map(entryOut), nextCursor: rows.length > f.limit ? f.cursor + f.limit : null };
}

export async function ownerPayout(ownerId: string, id: string) {
  const p = await one<PayoutRow>(`select ${PAYOUT_COLS} from payouts where id = $1 and owner_id = $2`, [id, ownerId]);
  if (!p) throw new ApiError('not_found', 'Payout not found.');
  const items = await q<EntryRow>(`${ENTRY_SELECT} where e.payout_id = $1 order by e.occurred_at, e.id`, [id]);
  return { unit: 'poisha' as const, payout: payoutOut(p), items: items.map(entryOut) };
}

// ── TurfSides admin (business dashboard) ─────────────────────────────────────────────────

const cutoffOf = (s?: string | Date) => {
  const c = s ? new Date(s) : lastMidnight();
  if (Number.isNaN(c.getTime())) throw new ApiError('invalid', 'cutoff must be a date and time (ISO 8601).');
  if (c.getTime() > Date.now()) throw new ApiError('invalid', 'cutoff can’t be in the future: only money already earned can be paid.');
  return c;
};

/** Each owner's unpaid earnings before `cutoff`: what a settlement would pay. */
async function dueBefore(c: PoolClient | null, cutoff: Date, ownerId?: string) {
  const sql = `select e.owner_id, o.name, o.phone, o.email, count(*)::int entries,
                      sum(e.gross) gross, sum(e.commission) commission, sum(e.net) amount
                 from owner_earnings e join owners o on o.id = e.owner_id
                where e.payout_id is null and e.occurred_at < $1 and ($2::uuid is null or e.owner_id = $2)
                group by e.owner_id, o.name, o.phone, o.email
                order by sum(e.net) desc`;
  const args = [cutoff, ownerId ?? null];
  type Due = { owner_id: string; name: string; phone: string | null; email: string | null; entries: number; gross: string; commission: string; amount: string };
  const rows = c ? (await c.query<Due>(sql, args)).rows : await q<Due>(sql, args);
  return rows.map((r) => ({
    ownerId: r.owner_id,
    name: r.name,
    phone: r.phone ? `+880${r.phone}` : null,
    email: r.email,
    bookings: r.entries,
    gross: n(r.gross),
    commission: n(r.commission),
    amount: n(r.amount),
    /** Only positive balances are paid; zero or negative ones carry over. */
    payable: n(r.amount) > 0,
  }));
}

export const previewQuery = z.object({ cutoff: z.string().max(40).optional(), ownerId: z.string().uuid().optional() });
/** What tonight's payouts would be, per owner, before marking anything paid. */
export async function previewPayouts(f: z.infer<typeof previewQuery>) {
  const cutoff = cutoffOf(f.cutoff);
  const owners = await dueBefore(null, cutoff, f.ownerId);
  const payable = owners.filter((o) => o.payable);
  return { unit: 'poisha' as const, cutoff, owners, total: payable.reduce((s, o) => s + o.amount, 0), payableOwners: payable.length };
}

export const settleInput = z.object({
  ownerId: z.string().uuid(),
  /** Earnings recorded before this instant are paid. Default: the last Dhaka midnight. */
  cutoff: z.string().max(40).optional(),
  /**
   * The amount (poisha) you transferred, from the preview. If the balance changed since (a new
   * cancellation, say), nothing is marked paid and you get the current amount back (409).
   */
  expectedAmount: z.number().int().positive().optional(),
  method: z.string().trim().min(1).max(40).default('bkash'),
  /** The bKash / bank transaction id of the transfer. */
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Marks one owner's unpaid earnings before the cutoff as paid, as one payout. All or nothing. */
export async function settle(s: z.infer<typeof settleInput>, actor: string, client?: PoolClient) {
  const cutoff = cutoffOf(s.cutoff);
  const run = async (c: PoolClient) => {
    // One settlement per owner at a time; concurrent runs wait, then find nothing left to pay.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`payout:${s.ownerId}`]);
    const owner = (await c.query<{ id: string }>('select id from owners where id = $1', [s.ownerId])).rows[0];
    if (!owner) throw new ApiError('not_found', 'Owner not found.');
    const lines = (
      await c.query<{ id: string; gross: string; commission: string; net: string }>(
        'select id, gross, commission, net from owner_earnings where owner_id = $1 and payout_id is null and occurred_at < $2 order by id for update',
        [s.ownerId, cutoff],
      )
    ).rows;
    const gross = lines.reduce((t, l) => t + n(l.gross), 0);
    const commission = lines.reduce((t, l) => t + n(l.commission), 0);
    const amount = lines.reduce((t, l) => t + n(l.net), 0);
    if (s.expectedAmount != null && s.expectedAmount !== amount)
      throw new ApiError('conflict', `The balance changed: it is now ${amount} poisha (৳${(amount / 100).toFixed(2)}). Nothing was marked paid.`);
    if (!lines.length || amount <= 0) return { paid: false as const, ownerId: s.ownerId, amount, bookings: lines.length, payout: null };
    const p = (
      await c.query<PayoutRow>(
        `insert into payouts (owner_id, cutoff, gross, commission, amount, entries, method, reference, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${PAYOUT_COLS}`,
        [s.ownerId, cutoff, gross, commission, amount, lines.length, s.method, s.reference ?? null, s.note ?? null, actor],
      )
    ).rows[0]!;
    const marked = await c.query('update owner_earnings set payout_id = $1 where id = any($2::bigint[]) and payout_id is null', [p.id, lines.map((l) => l.id)]);
    if (marked.rowCount !== lines.length) throw new ApiError('conflict', 'Some earnings changed while paying. Nothing was marked paid; try again.');
    await c.query("insert into audit_log (action, entity, entity_id, data) values ('payout.paid', 'payout', $1, $2)", [
      p.id,
      JSON.stringify({ ownerId: s.ownerId, amount, gross, commission, entries: lines.length, cutoff, reference: s.reference ?? null, by: actor }),
    ]);
    // Owner dashboards watching any of this owner's turfs refresh now (realtime), as for bookings.
    await c.query(
      `insert into slot_updates (venue_id, day, xid) select id, $2::date, pg_current_xact_id() from venues where owner_id = $1
         on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid`,
      [s.ownerId, dhakaToday()],
    );
    return { paid: true as const, ownerId: s.ownerId, amount, bookings: lines.length, payout: payoutOut(p) };
  };
  try {
    return client ? await run(client) : await tx(run);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('conflict', 'This owner was already paid for this cutoff.');
    throw e;
  }
}

export const settleAllInput = z.object({
  cutoff: z.string().max(40).optional(),
  method: z.string().trim().min(1).max(40).default('bkash'),
  note: z.string().trim().max(500).optional(),
});

/** The nightly run: every owner with a positive balance before the cutoff, each in its own transaction. */
export async function settleAll(s: z.infer<typeof settleAllInput>, actor: string) {
  const cutoff = cutoffOf(s.cutoff);
  const due = (await dueBefore(null, cutoff)).filter((o) => o.payable);
  const results = [];
  for (const o of due) {
    try {
      results.push(await settle({ ownerId: o.ownerId, cutoff: cutoff.toISOString(), method: s.method, note: s.note }, actor));
    } catch (e) {
      results.push({ paid: false as const, ownerId: o.ownerId, amount: o.amount, bookings: o.bookings, payout: null, error: (e as Error).message });
    }
  }
  const paid = results.filter((r) => r.paid);
  return { unit: 'poisha' as const, cutoff, paidOwners: paid.length, total: paid.reduce((t, r) => t + r.amount, 0), results };
}

export const voidInput = z.object({ reason: z.string().trim().min(3).max(500) });
/** Undo a payout marked paid by mistake: its earnings go back to pending. */
export async function voidPayout(id: string, reason: string, actor: string) {
  return tx(async (c) => {
    const p = (await c.query<PayoutRow>(`select ${PAYOUT_COLS} from payouts where id = $1 for update`, [id])).rows[0];
    if (!p) throw new ApiError('not_found', 'Payout not found.');
    if (p.status === 'void') throw new ApiError('conflict', 'This payout is already void.');
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`payout:${p.owner_id}`]);
    await c.query('update owner_earnings set payout_id = null where payout_id = $1', [id]);
    const v = (
      await c.query<PayoutRow>(
        `update payouts set status = 'void', voided_at = now(), void_reason = $2 where id = $1 returning ${PAYOUT_COLS}`,
        [id, reason],
      )
    ).rows[0]!;
    await c.query("insert into audit_log (action, entity, entity_id, data) values ('payout.void', 'payout', $1, $2)", [id, JSON.stringify({ reason, by: actor })]);
    await c.query(
      `insert into slot_updates (venue_id, day, xid) select id, $2::date, pg_current_xact_id() from venues where owner_id = $1
         on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid`,
      [p.owner_id, dhakaToday()],
    );
    return payoutOut(v);
  });
}

export const adminPayoutsQuery = listQuery.extend({
  ownerId: z.string().uuid().optional(),
  status: z.enum(['all', 'paid', 'void']).default('all'),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});
export async function adminPayouts(f: z.infer<typeof adminPayoutsQuery>) {
  const rows = await q<PayoutRow & { owner_name: string }>(
    `select p.${PAYOUT_COLS.split(', ').join(', p.')}, o.name owner_name from payouts p join owners o on o.id = p.owner_id
      where ($1::uuid is null or p.owner_id = $1) and ($2::text = 'all' or p.status = $2)
        and ($3::timestamptz is null or p.paid_at >= $3) and ($4::timestamptz is null or p.paid_at < $4)
      order by p.paid_at desc, p.id offset $5 limit $6`,
    [f.ownerId ?? null, f.status, f.from ?? null, f.to ?? null, f.cursor, f.limit + 1],
  );
  return {
    unit: 'poisha' as const,
    items: rows.slice(0, f.limit).map((r) => ({ ...payoutOut(r), ownerName: r.owner_name })),
    nextCursor: rows.length > f.limit ? f.cursor + f.limit : null,
  };
}

export async function adminPayout(id: string) {
  const p = await one<PayoutRow>(`select ${PAYOUT_COLS} from payouts where id = $1`, [id]);
  if (!p) throw new ApiError('not_found', 'Payout not found.');
  return ownerPayout(p.owner_id, id);
}

/** An owner's balance and lifetime totals. */
export async function adminOwnerBalance(ownerId: string) {
  const o = await one<{ id: string; name: string }>('select id, name from owners where id = $1', [ownerId]);
  if (!o) throw new ApiError('not_found', 'Owner not found.');
  const life = await one<{ gross: string; commission: string; net: string }>(
    'select coalesce(sum(gross), 0) gross, coalesce(sum(commission), 0) commission, coalesce(sum(net), 0) net from owner_earnings where owner_id = $1',
    [ownerId],
  );
  return {
    unit: 'poisha' as const,
    owner: o,
    commissionPercent: (await currentRate(ownerId)) / 100,
    ...(await balanceOf(ownerId)),
    lifetime: { gross: n(life?.gross), commission: n(life?.commission), net: n(life?.net) },
    nextPayoutAt: nextMidnight(),
  };
}

export const adminEntriesQuery = entriesQuery.extend({ ownerId: z.string().uuid() });
export const adminEntries = (f: z.infer<typeof adminEntriesQuery>) => ownerEntries(f.ownerId, f);

/** Platform totals between two instants (default: the last 30 days): sales, commission, refunds, payouts. */
export const summaryQuery = z.object({ from: z.string().max(40).optional(), to: z.string().max(40).optional() });
export async function adminSummary(f: z.infer<typeof summaryQuery>) {
  const to = f.to ? new Date(f.to) : new Date();
  const from = f.from ? new Date(f.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ApiError('invalid', 'from and to must be dates (ISO 8601).');
  const e = await one<Record<string, string>>(
    `select count(*) filter (where kind = 'sale') sales, coalesce(sum(gross) filter (where kind = 'sale'), 0) sales_gross,
            coalesce(sum(commission) filter (where kind = 'sale'), 0) sales_commission,
            count(*) filter (where kind = 'reversal') reversals, coalesce(sum(gross) filter (where kind = 'reversal'), 0) rev_gross,
            coalesce(sum(commission) filter (where kind = 'reversal'), 0) rev_commission, coalesce(sum(net), 0) net
       from owner_earnings where occurred_at >= $1 and occurred_at < $2`,
    [from, to],
  );
  const p = await one<{ n: string; amount: string }>(
    "select count(*) n, coalesce(sum(amount), 0) amount from payouts where status = 'paid' and paid_at >= $1 and paid_at < $2",
    [from, to],
  );
  const owed = await one<{ amount: string }>('select coalesce(sum(net), 0) amount from owner_earnings where payout_id is null');
  return {
    unit: 'poisha' as const,
    from,
    to,
    sales: { bookings: n(e?.sales), gross: n(e?.sales_gross), commission: n(e?.sales_commission) },
    refunds: { bookings: n(e?.reversals), gross: -n(e?.rev_gross), commission: -n(e?.rev_commission) },
    /** TurfSides' commission kept: on sales, minus that of refunded bookings. */
    commission: n(e?.sales_commission) + n(e?.rev_commission),
    ownersEarned: n(e?.net),
    payouts: { count: n(p?.n), amount: n(p?.amount) },
    /** Everything owed to owners right now (all pending balances). */
    owedNow: n(owed?.amount),
  };
}

export const rateInput = z.object({
  /** Basis points: 215 = 2.15%. */
  rateBp: z.number().int().min(0).max(10_000),
  /** Only this owner; left out = everyone without their own rate. */
  ownerId: z.string().uuid().optional(),
  /** When it starts (default now). Bookings confirmed from then on use it; earlier ones keep theirs. */
  effectiveFrom: z.string().max(40).optional(),
  note: z.string().trim().max(200).optional(),
});
export async function setRate(r: z.infer<typeof rateInput>, actor: string) {
  const at = r.effectiveFrom ? new Date(r.effectiveFrom) : new Date();
  if (Number.isNaN(at.getTime())) throw new ApiError('invalid', 'effectiveFrom must be a date and time (ISO 8601).');
  if (at.getTime() < Date.now() - 60_000) throw new ApiError('invalid', 'A new rate can’t start in the past: past bookings keep the rate they were charged.');
  if (r.ownerId && !(await one('select 1 from owners where id = $1', [r.ownerId]))) throw new ApiError('not_found', 'Owner not found.');
  await q('insert into commission_rates (owner_id, rate_bp, effective_from, note, created_by) values ($1,$2,$3,$4,$5)', [
    r.ownerId ?? null,
    r.rateBp,
    at,
    r.note ?? null,
    actor,
  ]);
  await q("insert into audit_log (action, entity, entity_id, data) values ('commission.set', 'owner', $1, $2)", [r.ownerId ?? 'all', JSON.stringify({ ...r, by: actor })]);
  return listRates();
}
export async function listRates() {
  const rows = await q<{ id: string; owner_id: string | null; rate_bp: number; effective_from: Date; note: string | null; created_by: string | null }>(
    'select id, owner_id, rate_bp, effective_from, note, created_by from commission_rates order by effective_from desc, id desc limit 200',
  );
  return {
    currentPercent: (await currentRate(null)) / 100,
    rates: rows.map((r) => ({ id: Number(r.id), ownerId: r.owner_id, rateBp: r.rate_bp, percent: r.rate_bp / 100, effectiveFrom: r.effective_from, note: r.note, by: r.created_by })),
  };
}
