/**
 * Owner earnings and payouts: every number checked to the poisha. ৳2,500 per slot at 2.15% →
 * commission ৳53.75, owner gets ৳2,446.25. Sales, cancellations (before and after a payout),
 * settlement (guards, double runs, void), walk-ins, commission changes and rounding.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const ADMIN = process.env.ADMIN_API_KEY ?? 'ci_admin_key_0123456789abcdefghijklmnop';
const d = API ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const admin = (method: string, path: string, body?: unknown) => call(method, path, body, undefined, { 'X-Admin-Key': ADMIN, 'X-Admin-User': 'test' });
async function newUser(role: 'player' | 'owner', name: string) {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const email = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`;
  const A = role === 'owner' ? '/v1/owner/auth' : '/v1/auth';
  const s = await call('POST', `${A}/signup/start`, { name, phone, email, password: 'owner pass 123' });
  const v = (await call('POST', `${A}/signup/verify`, { phone, code: s.json.devCode })).json as { accessToken: string; user: Json };
  return { ...v, phone, email };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

/** A player pays for these slots in the app (simulated bKash). Returns the confirmed booking ids. */
async function pay(token: string, slotIds: string[]) {
  const hold = await call('POST', '/v1/holds', { slotIds }, token);
  expect(hold.status, JSON.stringify(hold.json)).toBe(200);
  const p = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, token, { 'Idempotency-Key': randomUUID() });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  await fetch(`${API}/v1/payments/simulate/${p.json.paymentId}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=pay',
  });
  expect((await call('GET', `/v1/payments/${p.json.paymentId}`, undefined, token)).json.status).toBe('confirmed');
}

const now = () => new Date().toISOString();

d('owner earnings and payouts', () => {
  it('adds up to the poisha through sales, payouts, cancellations and rate changes', async () => {
    const o = await newUser('owner', 'Payout Owner');
    const ownerId = o.user.id as string;
    const v = await call(
      'POST',
      '/v1/owner/venues',
      {
        name: 'Payout Arena',
        area: 'Savar',
        city: 'Dhaka',
        address: 'Savar Road 1',
        lat: 23.85,
        lng: 90.26,
        formats: ['5-a-side'],
        schedule: { opens: '06:00', closes: '23:00', sessionMinutes: 60, breakMinutes: 0 },
        pricing: { hourly: 2500, per: 'slot' },
      },
      o.accessToken,
    );
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    const venueId = v.json.id as string;
    const day = dayIn(4);
    const slots = (await call('GET', `/v1/venues/${venueId}/slots?day=${day}`)).json.slots as Json[];
    expect(slots[0].price).toBe(250000);
    const earnings = async (range = '24h') => (await call('GET', `/v1/owner/earnings?range=${range}`, undefined, o.accessToken)).json;

    // The admin API needs its key.
    expect((await call('GET', '/v1/admin/payouts/preview')).status).toBe(401);
    expect((await call('GET', '/v1/admin/payouts/preview', undefined, undefined, { 'X-Admin-Key': 'wrong' })).status).toBe(401);

    // 1) Three slots paid in one order (not back to back: three tickets): three sales of ৳2,500 → ৳2,446.25 each.
    const p1 = await newUser('player', 'Rafi');
    await pay(p1.accessToken, [slots[0].id, slots[2].id, slots[4].id]);
    let e = await earnings();
    expect(e.unit).toBe('poisha');
    expect(e.commissionPercent).toBe(2.15);
    expect(e.sales).toEqual({ bookings: 3, gross: 750000, commission: 16125, net: 733875 });
    expect(e.earnings).toBe(733875);
    expect(e.balance).toMatchObject({ pending: 733875, pendingEntries: 3, paid: 0, payouts: 0, nextPayout: 733875, lastPayout: null });
    const list = (await call('GET', `/v1/owner/bookings?venueId=${venueId}&sort=day_asc`, undefined, o.accessToken)).json.items as Json[];
    expect(list[0].earning).toEqual({ price: 2500, commission: 53.75, youGet: 2446.25, commissionPercent: 2.15, status: 'pending', paidAt: null });

    // 2) Settle. The preview shows it; a wrong expected amount marks nothing paid.
    let cutoff = now();
    const pre = (await admin('GET', `/v1/admin/payouts/preview?cutoff=${encodeURIComponent(cutoff)}&ownerId=${ownerId}`)).json;
    expect(pre.owners).toEqual([expect.objectContaining({ ownerId, bookings: 3, gross: 750000, commission: 16125, amount: 733875, payable: true })]);
    const wrong = await admin('POST', '/v1/admin/payouts', { ownerId, cutoff, expectedAmount: 733800 });
    expect(wrong.status).toBe(409);
    expect((await earnings()).balance.pending).toBe(733875);
    expect((await admin('POST', '/v1/admin/payouts', { ownerId, cutoff: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(400);
    const paid = await admin('POST', '/v1/admin/payouts', { ownerId, cutoff, expectedAmount: 733875, reference: 'BKASH123' });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({ paid: true, amount: 733875, bookings: 3, payout: { amount: 733875, gross: 750000, commission: 16125, reference: 'BKASH123', status: 'paid' } });
    const payoutId = paid.json.payout.id as string;
    // Running it again for the same cutoff pays nothing.
    expect((await admin('POST', '/v1/admin/payouts', { ownerId, cutoff })).json).toMatchObject({ paid: false, amount: 0 });
    e = await earnings();
    expect(e.balance).toMatchObject({ pending: 0, pendingEntries: 0, paid: 733875, payouts: 1, nextPayout: 0, lastPayout: { id: payoutId, amount: 733875 } });
    const mineList = (await call('GET', '/v1/owner/payouts', undefined, o.accessToken)).json;
    expect(mineList.items).toHaveLength(1);
    const detail = (await call('GET', `/v1/owner/payouts/${payoutId}`, undefined, o.accessToken)).json;
    expect(detail.items.map((x: Json) => x.net)).toEqual([244625, 244625, 244625]);
    expect((await call('GET', `/v1/owner/bookings?venueId=${venueId}&sort=day_asc`, undefined, o.accessToken)).json.items[0].earning.status).toBe('paid');
    // Another owner can't see it.
    const other = await newUser('owner', 'Other Owner');
    expect((await call('GET', `/v1/owner/payouts/${payoutId}`, undefined, other.accessToken)).status).toBe(404);

    // 3) A new sale cancelled by the player before any payout: in and out, nothing owed.
    const p2 = await newUser('player', 'Nabil');
    await pay(p2.accessToken, [slots[6].id]);
    const nabil = (await call('GET', '/v1/me/bookings', undefined, p2.accessToken)).json as Json[];
    expect((await call('POST', `/v1/bookings/${nabil[0].id}/cancel`, {}, p2.accessToken)).status).toBe(200);
    e = await earnings();
    expect(e.balance.pending).toBe(0);
    expect(e.sales.bookings).toBe(4);
    expect(e.cancelled.app).toEqual({ bookings: 1, gross: 250000, commission: 5375, net: 244625 });
    expect(e.earnings).toBe(733875);

    // 4) The owner cancels a booking that was already paid out: it comes off the next payout.
    expect((await call('POST', `/v1/owner/bookings/${list[0].id}/cancel`, { reason: 'Pitch repair' }, o.accessToken)).status).toBe(200);
    e = await earnings();
    expect(e.balance).toMatchObject({ pending: -244625, nextPayout: 0, paid: 733875 });
    expect(e.cancelled.bookings).toBe(2);
    expect(e.cancelled.lost).toBe(489250);
    // A negative balance isn't paid; the nightly run skips this owner.
    cutoff = now();
    expect((await admin('POST', '/v1/admin/payouts', { ownerId, cutoff })).json).toMatchObject({ paid: false, amount: -244625 });
    const all1 = (await admin('POST', '/v1/admin/payouts/settle-all', { cutoff })).json;
    expect(all1.results.find((r: Json) => r.ownerId === ownerId)).toBeUndefined();

    // 5) Two more sales: −2,446.25 + 2 × 2,446.25 = ৳2,446.25 due.
    const p3 = await newUser('player', 'Tanvir');
    await pay(p3.accessToken, [slots[8].id, slots[9].id]);
    e = await earnings();
    expect(e.balance.pending).toBe(244625);
    // Walk-ins never pass through TurfSides: no earnings, counted on their own.
    const w = await call(
      'POST',
      '/v1/owner/bookings',
      { venueId, day, starts: [slots[11].start], guestName: 'Walk In', guestPhone: '01811000999', guestEmail: 'walk@test.turfsides.dev', amount: 2000 },
      o.accessToken,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(w.status, JSON.stringify(w.json)).toBe(200);
    e = await earnings();
    expect(e.balance.pending).toBe(244625);
    expect(e.walkins).toEqual({ bookings: 1, amount: 200000 });
    expect(w.json.bookings[0].earning).toBeNull();

    // 6) The nightly run pays it: 5 lines (2 sales, the reversal from 4, and 3's sale + reversal).
    cutoff = now();
    const all2 = (await admin('POST', '/v1/admin/payouts/settle-all', { cutoff, note: 'Nightly' })).json;
    const mine2 = all2.results.find((r: Json) => r.ownerId === ownerId);
    expect(mine2).toMatchObject({ paid: true, amount: 244625, bookings: 5 });
    expect((await earnings()).balance).toMatchObject({ pending: 0, paid: 733875 + 244625, payouts: 2 });

    // 7) Voiding it puts the money back to pending; paying again works.
    expect((await admin('POST', `/v1/admin/payouts/${mine2.payout.id}/void`, { reason: 'Wrong number' })).json.status).toBe('void');
    expect((await earnings()).balance).toMatchObject({ pending: 244625, paid: 733875, payouts: 1 });
    const again = await admin('POST', '/v1/admin/payouts', { ownerId, cutoff, expectedAmount: 244625 });
    expect(again.json).toMatchObject({ paid: true, amount: 244625 });
    const bal = (await admin('GET', `/v1/admin/owners/${ownerId}/balance`)).json;
    expect(bal).toMatchObject({ pending: 0, paid: 978500, payouts: 2, lifetime: { gross: 1000000, commission: 21500, net: 978500 } }); // 6 sales − 2 refunds

    // 8) A new rate for this owner applies from now on; old earnings keep theirs. Rounding: half up.
    expect((await admin('POST', '/v1/admin/commission', { ownerId, rateBp: 300 })).status).toBe(200);
    await call('PUT', `/v1/owner/venues/${venueId}`, { ...v.json, mapUrl: null, pricing: { hourly: 2499, per: 'slot' } }, o.accessToken);
    const s2 = (await call('GET', `/v1/venues/${venueId}/slots?day=${day}`)).json.slots as Json[];
    const p4 = await newUser('player', 'Sami');
    await pay(p4.accessToken, [s2[13].id]);
    e = await earnings();
    expect(e.commissionPercent).toBe(3);
    expect(e.balance.pending).toBe(249900 - 7497); // 249900 × 3% = 7497
    const entries = (await call('GET', '/v1/owner/earnings/entries?status=pending', undefined, o.accessToken)).json.items as Json[];
    expect(entries).toEqual([expect.objectContaining({ kind: 'sale', gross: 249900, commission: 7497, net: 242403, ratePercent: 3, status: 'pending' })]);
    // Back to the global rate; ৳2,499 at 2.15% = 53.7285 → ৳53.73 (half up).
    await admin('POST', '/v1/admin/commission', { ownerId, rateBp: 215 });
    const p5 = await newUser('player', 'Arif');
    await pay(p5.accessToken, [s2[15].id]);
    const last = (await call('GET', '/v1/owner/earnings/entries?status=pending', undefined, o.accessToken)).json.items[0];
    expect(last).toMatchObject({ gross: 249900, commission: 5373, net: 244527 });

    // Totals the business dashboard sees include this owner's money.
    const sum = (await admin('GET', '/v1/admin/finance/summary')).json;
    expect(sum.owedNow).toBeGreaterThanOrEqual(242403 + 244527);
    expect(sum.unit).toBe('poisha');
  });
});
