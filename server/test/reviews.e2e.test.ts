/**
 * Reviews: only players who booked and played can review a turf (one each, editable); the
 * turf rating and count come from real reviews.
 *   API_URL=… DATABASE_URL=… npm test
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API && process.env.DATABASE_URL ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: Json = {};
  try {
    json = JSON.parse(await res.text());
  } catch {
    /* redirect */
  }
  return { status: res.status, json };
}
const phone = () => `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
async function newUser(name: string) {
  const p = phone();
  const start = await call('POST', '/v1/auth/signup/start', { name, phone: p, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
  return (await call('POST', '/v1/auth/signup/verify', { phone: p, code: start.json.devCode })).json as { accessToken: string; user: Json };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

/** Book and pay (simulated) one slot; returns the booking id. */
async function paidBooking(token: string, venueId: string, offset: number) {
  const slots = (await call('GET', `/v1/venues/${venueId}/slots?day=${dayIn(offset)}`)).json.slots as Json[];
  const slot = slots.filter((s) => s.status === 'available').at(-1)!;
  const hold = await call('POST', '/v1/holds', { slotId: slot.id }, token, { 'Idempotency-Key': randomUUID() });
  expect(hold.status, JSON.stringify(hold.json)).toBe(200);
  const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, token, { 'Idempotency-Key': randomUUID() });
  await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
  const st = await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, token);
  expect(st.json.status).toBe('confirmed');
  return st.json.bookingId as string;
}

d('reviews', () => {
  const venue = 'v_kickoff_uttara';
  let db: pg.Client;
  let player: Awaited<ReturnType<typeof newUser>>;
  let stranger: Awaited<ReturnType<typeof newUser>>;
  let bookingId = '';
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('delete from reviews where venue_id = $1', [venue]); // start from a clean slate for this turf
    [player, stranger] = await Promise.all([newUser('Tanvir Ahmed'), newUser('Rafi Islam')]);
    bookingId = await paidBooking(player.accessToken, venue, 8);
  });
  afterAll(async () => {
    await db?.end();
  });

  it('a booked game that has not been played yet cannot be reviewed', async () => {
    const r = (await call('GET', `/v1/venues/${venue}/reviews`, undefined, player.accessToken)).json;
    expect(r).toMatchObject({ canReview: false, mine: null, count: 0, average: 0 });
    expect((await call('PUT', `/v1/venues/${venue}/reviews/mine`, { rating: 5, text: 'Great' }, player.accessToken)).status).toBe(403);
    // Nobody reviewed it yet: no rating on the turf.
    expect((await call('GET', `/v1/venues/${venue}`)).json).toMatchObject({ rating: 0, reviewCount: 0 });
  });

  it('after playing: write, see it counted, edit, delete; strangers cannot', async () => {
    // The game took place yesterday.
    await db.query(
      `update bookings set day = (now() at time zone 'Asia/Dhaka')::date - 1,
              during = tstzrange(now() - interval '26 hours', now() - interval '25 hours') where id = $1`,
      [bookingId],
    );
    expect((await call('GET', `/v1/venues/${venue}/reviews`, undefined, player.accessToken)).json.canReview).toBe(true);
    expect((await call('GET', `/v1/venues/${venue}/reviews`)).json.canReview).toBe(false); // signed out
    const bad = await call('PUT', `/v1/venues/${venue}/reviews/mine`, { rating: 6 }, player.accessToken);
    expect(bad.status).toBe(400);
    const saved = await call('PUT', `/v1/venues/${venue}/reviews/mine`, { rating: 5, text: '  Great surface, friendly staff.  ' }, player.accessToken);
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.mine).toMatchObject({ rating: 5, text: 'Great surface, friendly staff.' });

    const pub = (await call('GET', `/v1/venues/${venue}/reviews`)).json;
    expect(pub).toMatchObject({ count: 1, average: 5, histogram: { 5: 1 } });
    expect(pub.items[0]).toMatchObject({ author: 'Tanvir A.', rating: 5 }); // first name + initial only
    expect((await call('GET', `/v1/venues/${venue}`)).json).toMatchObject({ rating: 5, reviewCount: 1 });

    // Writing again edits the same review (one per player per turf).
    await call('PUT', `/v1/venues/${venue}/reviews/mine`, { rating: 3, text: 'Lights were dim.' }, player.accessToken);
    expect((await call('GET', `/v1/venues/${venue}/reviews`)).json).toMatchObject({ count: 1, average: 3, histogram: { 3: 1, 5: 0 } });

    // Never played here: refused.
    expect((await call('PUT', `/v1/venues/${venue}/reviews/mine`, { rating: 1, text: 'x' }, stranger.accessToken)).status).toBe(403);

    expect((await call('DELETE', `/v1/venues/${venue}/reviews/mine`, undefined, player.accessToken)).status).toBe(200);
    expect((await call('GET', `/v1/venues/${venue}`)).json).toMatchObject({ rating: 0, reviewCount: 0 });
  });
});
