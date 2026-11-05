import { config, isProd } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import * as bkash from '../lib/bkash';
import { randomToken } from '../lib/crypto';

import { invalidateDay } from './venues';

type PaymentRow = {
  id: string;
  booking_id: string;
  order_id: string | null;
  user_id: string;
  amount: number;
  status: string;
  invoice: string;
  provider_payment_id: string | null;
  created_at: Date;
};

// Time the user has on the bKash page (same as the cart hold).
const PAYMENT_WINDOW_MIN = () => config.HOLD_MINUTES;
const P_COLS = 'id, booking_id, order_id, user_id, amount, status, invoice, provider_payment_id, created_at';

/**
 * Start (or resume) a bKash payment for a hold. Idempotent per key: retrying after
 * a dropped connection returns the same payment instead of creating a second one.
 */
/** Where the browser goes after bKash: only our own app scheme (and Expo Go links outside production). */
export function safeReturnUrl(url?: string) {
  if (!url || url.length > 300) return null;
  const ok = url.startsWith(`${config.APP_SCHEME}://`) || (!isProd && /^exps?:\/\//.test(url));
  return ok ? url : null;
}

export async function startPayment(userId: string, holdId: string, idemKey: string, returnUrl?: string) {
  if (!bkash.bkashEnabled()) throw new ApiError('not_configured', 'Payments are not available yet.');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idemKey)) throw new ApiError('invalid', 'Missing or invalid Idempotency-Key header.');

  const existing = await one<PaymentRow & { checkout_url: string | null }>(
    `select ${P_COLS}, last_response->>'bkashURL' checkout_url from payments where idempotency_key = $1`,
    [idemKey],
  );
  if (existing) {
    if (existing.user_id !== userId) throw new ApiError('conflict', 'This request key was already used.');
    return { paymentId: existing.id, checkoutUrl: existing.checkout_url };
  }

  const payment = await tx(async (c) => {
    const o = (
      await c.query<{ id: string; status: string; total: number; hold_expires_at: Date }>(
        'select id, status, total, hold_expires_at from orders where id = $1 and user_id = $2 for update',
        [holdId, userId],
      )
    ).rows[0];
    if (!o) throw new ApiError('not_found', 'Your hold was not found. Please pick the slot again.');
    if (o.status !== 'held' || new Date(o.hold_expires_at) < new Date()) throw new ApiError('hold_expired', 'Your hold expired. Please pick the slot again.');
    const first = (await c.query<{ id: string }>('select id from bookings where order_id = $1 order by day, start_min limit 1', [o.id])).rows[0];
    if (!first) throw new ApiError('hold_expired', 'Your hold expired. Please pick the slot again.');
    const invoice = `TS${Date.now().toString(36).toUpperCase()}${randomToken(3).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
    const p = (
      await c.query<PaymentRow>(
        `insert into payments (booking_id, order_id, user_id, amount, status, idempotency_key, invoice) values ($1,$2,$3,$4,'initiated',$5,$6)
         returning ${P_COLS}`,
        [first.id, o.id, userId, o.total, idemKey, invoice],
      )
    ).rows[0];
    // Keep every slot in the order locked while the user is on the bKash page.
    await c.query("update orders set status = 'pending', hold_expires_at = now() + make_interval(mins => $2) where id = $1", [o.id, PAYMENT_WINDOW_MIN()]);
    await c.query("update bookings set status = 'pending', hold_expires_at = now() + make_interval(mins => $2) where order_id = $1 and status = 'held'", [o.id, PAYMENT_WINDOW_MIN()]);
    return p;
  });

  try {
    let paymentID: string;
    let bkashURL: string;
    if (bkash.isSimulated()) {
      paymentID = `SIM${payment.id.replaceAll('-', '').slice(0, 16)}`;
      bkashURL = `${config.PUBLIC_URL}/v1/payments/simulate/${payment.id}`;
    } else {
      const user = await one<{ phone: string }>('select phone from users where id = $1', [userId]);
      ({ paymentID, bkashURL } = await bkash.createPayment({
        amountPoisha: payment.amount,
        invoice: payment.invoice,
        payerReference: `0${user?.phone ?? ''}`,
        callbackURL: `${config.PUBLIC_URL}/v1/payments/bkash/callback`,
      }));
    }
    await q(
      "update payments set provider_payment_id = $2, status = 'pending', last_response = jsonb_build_object('bkashURL', $3::text, 'returnUrl', $4::text), updated_at = now() where id = $1",
      [payment.id, paymentID, bkashURL, safeReturnUrl(returnUrl)],
    );
    return { paymentId: payment.id, checkoutUrl: bkashURL };
  } catch (e) {
    // Couldn't reach bKash: release back to a held state so the user can retry with a new key.
    await tx(async (c) => {
      await c.query("update payments set status = 'failed', updated_at = now() where id = $1", [payment.id]);
      await c.query("update orders set status = 'held' where id = $1 and status = 'pending'", [payment.order_id]);
      await c.query("update bookings set status = 'held' where order_id = $1 and status = 'pending'", [payment.order_id]);
    });
    throw e;
  }
}

/**
 * Executes and verifies the payment with bKash, then confirms the booking.
 * Safe to call any number of times (callback, app polling, reconciliation job):
 * the payment row is locked and a completed payment is never processed twice.
 */
export async function finalize(paymentId: string): Promise<{ status: string; bookingId?: string }> {
  const p = await one<PaymentRow>(`select ${P_COLS} from payments where id = $1`, [paymentId]);
  if (!p) return { status: 'failed' };
  if (p.status === 'completed') return { status: 'confirmed', bookingId: p.booking_id };
  if (p.status !== 'pending' || !p.provider_payment_id) return { status: p.status === 'initiated' ? 'pending' : 'failed' };

  // 1) Ask bKash (outside the DB transaction: network calls never hold row locks).
  let result: bkash.ExecRes;
  if (bkash.isSimulated()) {
    const sim = await one<{ approved: boolean }>("select (last_response->>'simApproved')::boolean approved from payments where id = $1", [p.id]);
    if (!sim?.approved) return { status: 'pending' };
    result = { paymentID: p.provider_payment_id, trxID: `SIMTRX${p.id.slice(0, 8)}`, transactionStatus: 'Completed', amount: bkash.toTaka(p.amount), statusCode: '0000', statusMessage: 'Successful', merchantInvoiceNumber: p.invoice };
  } else {
    result = await bkash.executePayment(p.provider_payment_id);
    if (result.transactionStatus !== 'Completed') {
      const status = await bkash.queryPayment(p.provider_payment_id); // already executed, or not yet authorised?
      if (status.transactionStatus === 'Completed') result = status;
    }
  }

  const ok =
    result.transactionStatus === 'Completed' &&
    bkash.fromTaka(result.amount ?? '0') === p.amount &&
    (!result.merchantInvoiceNumber || result.merchantInvoiceNumber === p.invoice) &&
    !!result.trxID;
  if (!ok) return { status: 'pending' };

  // 2) Record it atomically.
  const out = await tx(async (c) => {
    const locked = (await c.query<{ status: string }>('select status from payments where id = $1 for update', [p.id])).rows[0];
    if (locked.status === 'completed') return { status: 'confirmed', bookingId: p.booking_id };
    // Every slot of the order (older payments cover a single booking).
    const slots = (
      await c.query<{ id: string; status: string; venue_id: string; day: string }>(
        p.order_id
          ? 'select id, status, venue_id, day::text from bookings where order_id = $1 order by day, start_min for update'
          : 'select id, status, venue_id, day::text from bookings where id = $1 for update',
        [p.order_id ?? p.booking_id],
      )
    ).rows;
    const ids = slots.map((x) => x.id);
    await c.query("update payments set status = 'completed', trx_id = $2, last_response = last_response || $3::jsonb, updated_at = now() where id = $1", [
      p.id,
      result.trxID,
      JSON.stringify({ trxID: result.trxID, transactionStatus: result.transactionStatus }),
    ]);
    await c.query("insert into ledger_entries (payment_id, booking_id, kind, amount, note) values ($1,$2,'charge',$3,'bKash')", [p.id, p.booking_id, p.amount]);

    let confirmed = slots.length > 0 && slots.every((x) => x.status === 'pending' || x.status === 'held');
    if (!confirmed && slots.length && slots.every((x) => ['pending', 'held', 'expired'].includes(x.status))) {
      // Paid after the hold ran out: re-confirm only if every slot is still free (all or nothing).
      await c.query('savepoint late');
      try {
        await c.query("update bookings set status = 'confirmed' where id = any($1::uuid[])", [ids]);
        confirmed = true;
      } catch {
        await c.query('rollback to savepoint late');
      }
    }
    if (confirmed) {
      await c.query("update bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = any($1::uuid[])", [ids]);
      if (p.order_id) await c.query("update orders set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = $1", [p.order_id]);
      await c.query(
        "insert into notifications (user_id, kind, title, body) values ($1, 'payment', 'Payment received', $2)",
        [
          p.user_id,
          `৳${Math.round(p.amount / 100).toLocaleString('en-IN')} via bKash. ${ids.length > 1 ? `Your ${ids.length} slots are` : 'Your booking is'} confirmed.`,
        ],
      );
    } else {
      // Never double-book: money is flagged for refund and support is notified via the audit log.
      await c.query("update payments set status = 'refund_required' where id = $1", [p.id]);
      if (p.order_id) await c.query("update orders set status = 'expired' where id = $1 and status <> 'confirmed'", [p.order_id]);
      await c.query("insert into audit_log(action, entity, entity_id, data) values ('payment.late_refund', 'payment', $1, $2)", [p.id, JSON.stringify({ bookingIds: ids, orderId: p.order_id })]);
      await c.query(
        "insert into notifications (user_id, kind, title, body) values ($1, 'payment', 'Slot no longer available', 'Your payment arrived after the slot was taken. A full refund is on its way.')",
        [p.user_id],
      );
    }
    return { status: confirmed ? 'confirmed' : 'refund_required', bookingId: p.booking_id, days: slots.map((x) => [x.venue_id, x.day] as const) };
  });
  if ('days' in out && out.days) await Promise.all([...new Set(out.days.map(([v, d]) => `${v}|${d}`))].map((k) => invalidateDay(k.split('|')[0], k.split('|')[1])));
  return { status: out.status === 'refund_required' ? 'failed' : out.status, bookingId: out.bookingId };
}

/** Callback for cancel / failure from bKash: free the slot again for a retry. */
export async function abandon(paymentId: string, status: 'cancelled' | 'failed') {
  await tx(async (c) => {
    const p = (await c.query<{ booking_id: string; order_id: string | null; status: string }>('select booking_id, order_id, status from payments where id = $1 for update', [paymentId])).rows[0];
    if (!p || p.status !== 'pending') return;
    await c.query('update payments set status = $2, updated_at = now() where id = $1', [paymentId, status]);
    if (p.order_id) {
      await c.query("update orders set status = 'held', hold_expires_at = least(hold_expires_at, now() + interval '5 minutes') where id = $1 and status = 'pending'", [p.order_id]);
      await c.query("update bookings set status = 'held', hold_expires_at = least(hold_expires_at, now() + interval '5 minutes') where order_id = $1 and status = 'pending'", [p.order_id]);
    } else {
      await c.query("update bookings set status = 'held', hold_expires_at = least(hold_expires_at, now() + interval '5 minutes') where id = $1 and status = 'pending'", [p.booking_id]);
    }
  });
}

export async function paymentStatus(userId: string, paymentId: string) {
  const p = await one<{ id: string; status: string; booking_id: string }>('select id, status, booking_id from payments where id = $1 and user_id = $2', [paymentId, userId]);
  if (!p) throw new ApiError('not_found', 'Payment not found.');
  if (p.status === 'completed') return { status: 'confirmed', bookingId: p.booking_id };
  if (p.status === 'pending') return finalize(p.id);
  return { status: p.status === 'initiated' ? 'pending' : 'failed' };
}

/** Scheduled job: settle pending payments whose callback was missed, and release expired holds. */
export async function reconcile() {
  const pending = await q<{ id: string; expired: boolean; booking_id: string; order_id: string | null }>(
    `select p.id, (coalesce(o.hold_expires_at, b.hold_expires_at) < now() - interval '2 minutes') as expired, p.booking_id, p.order_id
       from payments p join bookings b on b.id = p.booking_id left join orders o on o.id = p.order_id
      where p.status = 'pending' and p.created_at < now() - interval '1 minute' order by p.created_at limit 25`,
  );
  let settled = 0;
  for (const p of pending) {
    const r = await finalize(p.id).catch(() => ({ status: 'pending' }));
    if (r.status === 'confirmed') settled++;
    else if (p.expired) {
      await tx(async (c) => {
        await c.query("update payments set status = 'failed', updated_at = now() where id = $1 and status = 'pending'", [p.id]);
        if (p.order_id) {
          await c.query("update orders set status = 'expired' where id = $1 and status = 'pending'", [p.order_id]);
          await c.query("update bookings set status = 'expired' where order_id = $1 and status = 'pending'", [p.order_id]);
        } else {
          await c.query("update bookings set status = 'expired' where id = $1 and status = 'pending'", [p.booking_id]);
        }
      });
    }
  }
  const released = (await one<{ n: number }>('select release_expired_holds() n'))?.n ?? 0;
  return { checked: pending.length, settled, releasedHolds: released };
}
