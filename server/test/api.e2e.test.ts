/**
 * End-to-end tests against a running API (staging, BKASH_MODE=simulate).
 *   API_URL=http://localhost:4010 npm test
 */
import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;

type Json = Record<string, any>;
/** Two-step sign-in: password, then the emailed code (returned as devCode by the test server). */
async function signIn(identifier: string, password: string, headers: Record<string, string> = {}) {
  const step1 = await call('POST', '/v1/auth/login', { identifier, password }, undefined, headers);
  if (step1.status !== 200 || step1.json.accessToken) return step1; // two-step off: signed in already
  return call('POST', '/v1/auth/login/verify', { challenge: step1.json.challenge, code: step1.json.devCode }, undefined, headers);
}

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* html / redirect */
  }
  return { status: res.status, json, headers: res.headers };
}

const day0 = (slotId: string) => slotId.split(':')[1];
const phone = () => `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function newUser(name = 'Test Player') {
  const p = phone();
  const start = await call('POST', '/v1/auth/signup/start', { name, phone: p, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
  expect(start.status).toBe(200);
  const verify = await call('POST', '/v1/auth/signup/verify', { phone: p, code: start.json.devCode });
  expect(verify.status).toBe(200);
  return { phone: p, ...verify.json } as { phone: string; accessToken: string; refreshToken: string; user: Json };
}

async function freeSlot(venueId = 'v_bashundhara', offset = 1) {
  const day = new Date(Date.now() + 6 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
  const r = await call('GET', `/v1/venues/${venueId}/slots?day=${day}`);
  const slot = r.json.slots.find((s: Json) => s.status === 'available');
  expect(slot).toBeTruthy();
  return slot as { id: string; price: number };
}

d('TurfSides API', () => {
  let a: Awaited<ReturnType<typeof newUser>>;
  let b: Awaited<ReturnType<typeof newUser>>;
  beforeAll(async () => {
    a = await newUser('Alice Player');
    b = await newUser('Bob Player');
  });

  it('health is ok', async () => {
    const r = await call('GET', '/health');
    expect(r.json.db).toBe('ok');
  });

  it('auth: two-step sign-in is off by default, and needs the emailed code when switched on', async () => {
    // Off (default): the password alone signs you in.
    const settings = (await call('GET', '/v1/me/settings', undefined, a.accessToken)).json;
    expect(settings).toMatchObject({ twoFactor: false, hasEmail: true });
    const plain = await call('POST', '/v1/auth/login', { identifier: a.phone, password: 'correct horse 1' });
    expect(plain.status).toBe(200);
    expect(plain.json.accessToken).toBeTruthy();
    expect(plain.json.otpRequired).toBeUndefined();
    // On: a code is needed after the password.
    expect((await call('PUT', '/v1/me/settings', { twoFactor: true }, a.accessToken)).json.twoFactor).toBe(true);
    const step1 = await call('POST', '/v1/auth/login', { identifier: a.phone, password: 'correct horse 1' });
    expect(step1.status).toBe(200);
    expect(step1.json).toMatchObject({ otpRequired: true });
    expect(step1.json.accessToken).toBeUndefined(); // no session from the password alone
    expect(step1.json.challenge).not.toContain(a.phone);
    const wrong = await call('POST', '/v1/auth/login/verify', { challenge: step1.json.challenge, code: step1.json.devCode === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const forged = await call('POST', '/v1/auth/login/verify', { challenge: `${step1.json.challenge}x`, code: step1.json.devCode });
    expect(forged.status).toBe(400);
    const ok = await call('POST', '/v1/auth/login/verify', { challenge: step1.json.challenge, code: step1.json.devCode });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.accessToken).toBeTruthy();
    // A code works once.
    expect((await call('POST', '/v1/auth/login/verify', { challenge: step1.json.challenge, code: step1.json.devCode })).status).toBe(400);
    // Switched off again: back to password only.
    // Turning it off needs the password: without it, or with a wrong one, it stays on.
    expect((await call('PUT', '/v1/me/settings', { twoFactor: false }, ok.json.accessToken)).status).toBe(400);
    expect((await call('PUT', '/v1/me/settings', { twoFactor: false, password: 'wrong pass 99' }, ok.json.accessToken)).status).toBe(400);
    expect((await call('GET', '/v1/me/settings', undefined, ok.json.accessToken)).json.twoFactor).toBe(true);
    expect((await call('PUT', '/v1/me/settings', { twoFactor: false, password: 'correct horse 1' }, ok.json.accessToken)).json.twoFactor).toBe(false);
    expect((await call('POST', '/v1/auth/login', { identifier: a.phone, password: 'correct horse 1' })).json.accessToken).toBeTruthy();
  });

  it('auth: login, wrong password, refresh rotation with reuse detection', async () => {
    const bad = await call('POST', '/v1/auth/login', { identifier: a.phone, password: 'nope-nope' });
    expect(bad.status).toBe(401);
    const ok = await signIn(`+880${a.phone}`, 'correct horse 1');
    expect(ok.status).toBe(200);
    const r1 = await call('POST', '/v1/auth/refresh', { refreshToken: ok.json.refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await call('POST', '/v1/auth/refresh', { refreshToken: ok.json.refreshToken });
    expect(reuse.status).toBe(401);
    const after = await call('POST', '/v1/auth/refresh', { refreshToken: r1.json.refreshToken });
    expect(after.status).toBe(401); // whole family revoked after reuse
  });

  it('auth: wrong OTP is counted and rejected; protected routes need a token', async () => {
    const p = phone();
    await call('POST', '/v1/auth/signup/start', { name: 'Otp Test', phone: p, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'password123' });
    const wrong = await call('POST', '/v1/auth/signup/verify', { phone: p, code: '000000' });
    expect(wrong.status).toBe(400);
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, 'garbage')).status).toBe(401);
  });

  it('explore returns nearby venues with distances and adaptive radius', async () => {
    const r = await call('GET', '/v1/venues/explore?lat=23.8191&lng=90.4526&format=any');
    expect(r.status).toBe(200);
    expect(r.json.near.length + r.json.further.length).toBeGreaterThan(0);
    expect(r.json.near[0].id).toBe('v_bashundhara');
    expect(r.json.near[0].photo).toMatch(/^http/);
  });

  it('venue detail and slots: price computed server-side', async () => {
    const v = await call('GET', '/v1/venues/v_bashundhara');
    expect(v.json.name).toBe('Bashundhara Arena');
    const s = await freeSlot();
    expect(s.price).toBeGreaterThan(0);
  });

  it('saved venues: add, list, remove', async () => {
    expect((await call('PUT', '/v1/me/saved/v_gulshan_goal', undefined, a.accessToken)).json.isSaved).toBe(true);
    expect((await call('GET', '/v1/me/saved', undefined, a.accessToken)).json.map((x: Json) => x.id)).toContain('v_gulshan_goal');
    await call('DELETE', '/v1/me/saved/v_gulshan_goal', undefined, a.accessToken);
    expect((await call('GET', '/v1/me/saved', undefined, a.accessToken)).json).toHaveLength(0);
  });

  it('double booking is impossible: two players race for the same slot', async () => {
    const slot = await freeSlot('v_mirpur_dome', 2);
    const [r1, r2] = await Promise.all([
      call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() }),
      call('POST', '/v1/holds', { slotId: slot.id }, b.accessToken, { 'Idempotency-Key': randomUUID() }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.json.error.code).toBe('slot_taken');
  });

  it('idempotent hold: same key returns the same hold', async () => {
    const slot = await freeSlot('v_gulshan_goal', 3);
    const key = randomUUID();
    const h1 = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': key });
    const h2 = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': key });
    expect(h1.status).toBe(200);
    expect(h2.json.holdId).toBe(h1.json.holdId);
    const other = await call('POST', '/v1/holds', { slotId: slot.id }, b.accessToken, { 'Idempotency-Key': key });
    expect(other.status).toBe(409); // key belongs to another user
  });

  it('full checkout: hold → payment → (simulated) bKash → confirmed booking with signed pass', async () => {
    const slot = await freeSlot('v_bashundhara', 4);
    const hold = await call('POST', '/v1/holds', { slotId: slot.id }, b.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(hold.json.total).toBe(slot.price);
    const payKey = randomUUID();
    // A customer note longer than 300 characters is refused; a normal one rides along.
    expect((await call('POST', '/v1/payments', { holdId: hold.json.holdId, note: 'x'.repeat(301) }, b.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(400);
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId, note: '  Bringing our own bibs  ' }, b.accessToken, { 'Idempotency-Key': payKey });
    expect(pay.status).toBe(200);
    const again = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, b.accessToken, { 'Idempotency-Key': payKey });
    expect(again.json.paymentId).toBe(pay.json.paymentId); // retry never creates a 2nd payment

    // Not paid yet → still pending; another player can't steal the slot meanwhile.
    expect((await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, b.accessToken)).json.status).toBe('pending');
    const steal = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(steal.status).toBe(409);

    // A forged "success" callback for an unknown payment is rejected.
    expect((await call('GET', '/v1/payments/bkash/callback?paymentID=FAKE123&status=success')).status).toBe(404);

    // User approves on the (simulated) bKash page.
    const res = await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^turfsides:\/\/payment-return\?paymentId=.*status=confirmed/);

    const st = await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, b.accessToken);
    expect(st.json.status).toBe('confirmed');
    const booking = await call('GET', `/v1/bookings/${st.json.bookingId}`, undefined, b.accessToken);
    expect(booking.json.status).toBe('confirmed');
    expect(booking.json.note).toBe('Bringing our own bibs');
    // The QR carries the ticket itself: "TSP2.<signature>.<ticket JSON>".
    expect(booking.json.passToken).toMatch(/^TSP2\.[\w-]{22}\.\{/);
    const ticket = JSON.parse(booking.json.passToken.slice(booking.json.passToken.indexOf('{')));
    expect(ticket).toMatchObject({ v: 2, code: booking.json.code, venue: expect.any(String), date: day0(slot.id), paid: slot.price / 100, via: 'bKash' });
    expect(ticket.from).toMatch(/^\d\d:\d\d$/);
    expect(ticket.phone).toMatch(/^\d{3}\*+\d{3}$/); // masked
    expect(ticket.exp * 1000).toBeGreaterThan(Date.now());
    expect(booking.json.amountPaid).toBe(slot.price);

    // Other users can't read it.
    expect((await call('GET', `/v1/bookings/${st.json.bookingId}`, undefined, a.accessToken)).status).toBe(404);
    // Slot now shows booked.
    const day = slot.id.split(':')[1];
    const slots = await call('GET', `/v1/venues/v_bashundhara/slots?day=${day}`);
    expect(slots.json.slots.find((s: Json) => s.id === slot.id).status).toBe('booked');
    // Appears in my bookings + a notification was created.
    expect((await call('GET', '/v1/me/bookings', undefined, b.accessToken)).json.map((x: Json) => x.id)).toContain(st.json.bookingId);
    expect((await call('GET', '/v1/me/notifications', undefined, b.accessToken)).json[0].title).toBe('Payment received');
  });

  it('back-to-back slots make one ticket; a separate slot in the same payment gets its own', async () => {
    const u = await newUser('Two Tickets');
    const day = new Date(Date.now() + 6 * 3600_000 + 11 * 86400_000).toISOString().slice(0, 10);
    const free = ((await call('GET', `/v1/venues/v_badda_pitch/slots?day=${day}`)).json.slots as Json[]).filter((x) => x.status === 'available');
    // Two touching slots, plus one with a gap after them.
    const i = free.findIndex((x, k) => free[k + 1] && x.end === free[k + 1].start);
    const [s1, s2] = [free[i], free[i + 1]];
    const s3 = free.find((x) => x.start > s2.end)!;
    expect(s1 && s2 && s3).toBeTruthy();
    const hold = await call('POST', '/v1/holds', { slotIds: [s1.id, s2.id, s3.id] }, u.accessToken, { 'Idempotency-Key': randomUUID() });
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, u.accessToken, { 'Idempotency-Key': randomUUID() });
    await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    const st = await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, u.accessToken);
    expect(st.json.status).toBe('confirmed');

    // My bookings: two tickets, one payment.
    const all = (await call('GET', '/v1/me/bookings?filter=all&limit=10', undefined, u.accessToken)).json;
    expect(all.items).toHaveLength(2);
    const joined = all.items.find((x: Json) => x.slotCount === 2);
    const single = all.items.find((x: Json) => x.slotCount === 1);
    // The joined ticket runs first start → last end, costs both slots, and one QR says so.
    expect(joined).toMatchObject({ start: s1.start, end: s2.end, amountPaid: s1.price + s2.price });
    expect(single).toMatchObject({ start: s3.start, end: s3.end, amountPaid: s3.price });
    expect(joined.code).not.toBe(single.code);
    const pass = JSON.parse(joined.passToken.slice(joined.passToken.indexOf('{')));
    expect(pass).toMatchObject({ code: joined.code, paid: (s1.price + s2.price) / 100 });
    expect(pass.slots).toBeUndefined();
    // Each ticket points at the other one from the same payment.
    expect(joined.otherTickets.map((t: Json) => t.id)).toEqual([single.id]);
    expect(single.otherTickets.map((t: Json) => t.id)).toEqual([joined.id]);
    // Opening the second slot of the joined ticket opens that ticket.
    const s2Booking = (await call('GET', `/v1/bookings/${joined.id}`, undefined, u.accessToken)).json;
    expect(s2Booking).toMatchObject({ id: joined.id, start: s1.start, end: s2.end, slotCount: 2 });
    // The next game on top is the joined ticket, whole.
    const open = (await call('GET', '/v1/me/bookings?filter=open&limit=10', undefined, u.accessToken)).json;
    expect(open.next).toMatchObject({ id: joined.id, end: s2.end });
    // Others can't see it.
    expect((await call('GET', `/v1/bookings/${joined.id}`, undefined, a.accessToken)).status).toBe(404);
  });

  it('cancelled payment frees the hold for a retry', async () => {
    const slot = await freeSlot('v_badda_pitch', 5);
    const hold = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    const res = await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=cancel' });
    expect(res.headers.get('location')).toMatch(/status=cancel/);
    const retry = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(retry.status).toBe(200);
  });

  it('internal reconcile requires the cron secret', async () => {
    expect((await call('POST', '/internal/reconcile')).status).toBe(401);
    expect((await call('POST', '/internal/reconcile', undefined, undefined, { 'x-cron-secret': 'wrong-wrong-wrong-wrong-wrong' })).status).toBe(401);
  });

  it('rejects junk input', async () => {
    expect((await call('POST', '/v1/holds', { slotId: "v_x:2026-01-01:1;drop table users" }, a.accessToken)).status).toBe(400);
    expect((await call('GET', '/v1/venues/v_bashundhara/slots?day=yesterday')).status).toBe(400);
    expect((await call('POST', '/v1/auth/signup/start', { name: 'x', phone: '123', password: 'short' })).status).toBe(400);
  });
});

d('saved locations', () => {
  it('creates, lists, edits and deletes places, scoped to the owner', async () => {
    const a = await newUser('Places A');
    const b = await newUser('Places B');
    const made = await call('POST', '/v1/me/places', { label: 'Home', name: 'Uttara', city: 'Dhaka', address: 'Sector 7, Uttara', lat: 23.87281234, lng: 90.39845678 }, a.accessToken);
    expect(made.status).toBe(200);
    expect(made.json.lat).toBe(23.873); // rounded server-side
    const list = await call('GET', '/v1/me/places', undefined, a.accessToken);
    expect(list.json.map((p: Json) => p.id)).toEqual([made.json.id]);
    expect((await call('GET', '/v1/me/places', undefined, b.accessToken)).json).toEqual([]);
    // Another user can neither edit nor delete it.
    expect((await call('PUT', `/v1/me/places/${made.json.id}`, { label: 'X', name: 'X', lat: 1, lng: 1 }, b.accessToken)).status).toBe(404);
    await call('DELETE', `/v1/me/places/${made.json.id}`, undefined, b.accessToken);
    expect((await call('GET', '/v1/me/places', undefined, a.accessToken)).json).toHaveLength(1);
    const edited = await call('PUT', `/v1/me/places/${made.json.id}`, { label: 'Work', name: 'Gulshan', city: 'Dhaka', lat: 23.79, lng: 90.41 }, a.accessToken);
    expect(edited.json).toMatchObject({ label: 'Work', name: 'Gulshan' });
    expect((await call('POST', '/v1/me/places', { label: '', name: 'x', lat: 0, lng: 0 }, a.accessToken)).status).toBe(400);
    expect((await call('GET', '/v1/me/places')).status).toBe(401);
    await call('DELETE', `/v1/me/places/${made.json.id}`, undefined, a.accessToken);
    expect((await call('GET', '/v1/me/places', undefined, a.accessToken)).json).toEqual([]);
  });
});

d('explore radius', () => {
  it('honours a fixed radius from the distance slider', async () => {
    const all = (r: Json) => [...r.json.near, ...r.json.further];
    const tight = await call('GET', '/v1/venues/explore?lat=23.8191&lng=90.4526&radius=1');
    expect(tight.json.radiusKm).toBe(1);
    expect(all(tight).every((v: Json) => v.distanceKm <= 1)).toBe(true);
    const wide = await call('GET', '/v1/venues/explore?lat=23.8191&lng=90.4526&radius=50');
    expect(wide.json.radiusKm).toBe(50);
    expect(all(wide).length).toBeGreaterThanOrEqual(6);
    expect((await call('GET', '/v1/venues/explore?lat=23.8&lng=90.4&radius=500')).status).toBe(400);
  });
});

d('holds: someone booking vs your cart', () => {
  it('shows a hold as "held" to others and "mine" to its owner, resumes it, and releases it', async () => {
    const a = await newUser('Holder A');
    const b = await newUser('Watcher B');
    const day = new Date(Date.now() + 6 * 3600_000 + 5 * 86400_000).toISOString().slice(0, 10);
    const slotsFor = async (token?: string) => (await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}`, undefined, token)).json.slots as Json[];
    const slot = (await slotsFor()).find((s) => s.status === 'available')!;

    const hold = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(hold.status).toBe(200);
    const mine = (await slotsFor(a.accessToken)).find((s) => s.id === slot.id)!;
    expect(mine).toMatchObject({ status: 'mine', holdId: hold.json.holdId });
    expect((await slotsFor(b.accessToken)).find((s) => s.id === slot.id)!.status).toBe('held');
    expect((await slotsFor()).find((s) => s.id === slot.id)!.status).toBe('held');

    // Back from checkout and picking it again resumes the same hold (no "slot taken").
    const again = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(again.json.holdId).toBe(hold.json.holdId);
    // B can't take it while it's held.
    expect((await call('POST', '/v1/holds', { slotId: slot.id }, b.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(409);

    const cart = await call('GET', '/v1/me/holds', undefined, a.accessToken);
    expect(cart.json.map((h: Json) => h.holdId)).toEqual([hold.json.holdId]);
    // Only the holder can release it.
    expect((await call('DELETE', `/v1/holds/${hold.json.holdId}`, undefined, b.accessToken)).json.released).toBe(false);
    expect((await call('DELETE', `/v1/holds/${hold.json.holdId}`, undefined, a.accessToken)).json.released).toBe(true);
    expect((await slotsFor(b.accessToken)).find((s) => s.id === slot.id)!.status).toBe('available');
    expect((await call('GET', '/v1/me/holds', undefined, a.accessToken)).json).toEqual([]);
    expect((await call('POST', '/v1/holds', { slotId: slot.id }, b.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(200);
  });
});

d('cart: one order, one turf, many slots', () => {
  it('replaces the cart on a new pick and frees the old slots at once', async () => {
    const a = await newUser('Cart A');
    const b = await newUser('Cart B');
    const day = new Date(Date.now() + 6 * 3600_000 + 4 * 86400_000).toISOString().slice(0, 10);
    const slotsAt = async (venueId: string, token?: string) =>
      (await call('GET', `/v1/venues/${venueId}/slots?day=${day}`, undefined, token)).json.slots as Json[];
    const free = (await slotsAt('v_gulshan_goal')).filter((s) => s.status === 'available');
    const [s1, s2, s3] = free;

    // Two slots at one turf → one order.
    const first = await call('POST', '/v1/holds', { slotIds: [s1.id, s2.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(first.status).toBe(200);
    expect(first.json.slots.map((s: Json) => s.id)).toEqual([s1.id, s2.id]);
    expect(first.json.total).toBe(s1.price + s2.price);
    expect(first.json.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000); // 5-minute window

    // A realtime-triggered refetch (fresh=1) sees the hold immediately, past the server cache.
    const freshly = (await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}&fresh=1`, undefined, b.accessToken)).json.slots as Json[];
    expect(freshly.find((s) => s.id === s1.id)!.status).toBe('held');

    // Same selection again resumes it.
    const resume = await call('POST', '/v1/holds', { slotIds: [s2.id, s1.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(resume.json.holdId).toBe(first.json.holdId);

    // A new pick replaces the cart; the dropped slot is free for others immediately.
    const second = await call('POST', '/v1/holds', { slotIds: [s3.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(second.status).toBe(200);
    expect(second.json.holdId).not.toBe(first.json.holdId);
    const cart = await call('GET', '/v1/me/holds', undefined, a.accessToken);
    expect(cart.json.map((h: Json) => h.holdId)).toEqual([second.json.holdId]);
    const seenByB = await slotsAt('v_gulshan_goal', b.accessToken);
    expect(seenByB.find((s) => s.id === s1.id)!.status).toBe('available');
    expect(seenByB.find((s) => s.id === s3.id)!.status).toBe('held');
    expect((await call('POST', '/v1/holds', { slotId: s1.id }, b.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(200);

    // The old cart can't be paid any more.
    expect((await call('POST', '/v1/payments', { holdId: first.json.holdId }, a.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(410);

    // Picking at another turf replaces the cart too (never two turfs at once).
    const other = (await slotsAt('v_bashundhara')).find((s) => s.status === 'available')!;
    const moved = await call('POST', '/v1/holds', { slotIds: [other.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(moved.json.venue.id).toBe('v_bashundhara');
    expect((await slotsAt('v_gulshan_goal', b.accessToken)).find((s) => s.id === s3.id)!.status).toBe('available');
    expect((await call('GET', '/v1/me/holds', undefined, a.accessToken)).json).toHaveLength(1);

    // One order can't mix turfs.
    const mixed = await call('POST', '/v1/holds', { slotIds: [s3.id, other.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(mixed.status).toBe(400);
  });

  it('removes one slot from the cart and frees it for others at once', async () => {
    const a = await newUser('Remover');
    const b = await newUser('Watcher');
    const day = new Date(Date.now() + 6 * 3600_000 + 5 * 86400_000).toISOString().slice(0, 10);
    const free = ((await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}`)).json.slots as Json[]).filter((s) => s.status === 'available');
    const [s1, s2] = free;
    const hold = await call('POST', '/v1/holds', { slotIds: [s1.id, s2.id] }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(hold.json.lines[0].label).toMatch(/^\w{3} \d{1,2} \w{3} · \d{1,2}:\d{2}/); // "Sat 7 Nov · 9:00–10:30 AM"
    expect(hold.json.slots[0].price).toBe(s1.price);
    const path = (id: string) => `/v1/holds/${hold.json.holdId}/slots/${encodeURIComponent(id)}`;

    // Someone else can't touch it.
    expect((await call('DELETE', path(s1.id), undefined, b.accessToken)).status).toBe(410);

    const one = await call('DELETE', path(s1.id), undefined, a.accessToken);
    expect(one.status).toBe(200);
    expect(one.json.released).toBe(false);
    expect(one.json.hold.slots.map((s: Json) => s.id)).toEqual([s2.id]);
    expect(one.json.hold.total).toBe(s2.price);
    expect(one.json.hold.lines).toHaveLength(2); // one slot + service fee
    const seen = (await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}`, undefined, b.accessToken)).json.slots as Json[];
    expect(seen.find((s) => s.id === s1.id)!.status).toBe('available');
    expect(seen.find((s) => s.id === s2.id)!.status).toBe('held');
    expect((await call('DELETE', path(s1.id), undefined, a.accessToken)).status).toBe(404);

    // Removing the last slot empties the cart.
    const last = await call('DELETE', path(s2.id), undefined, a.accessToken);
    expect(last.json.released).toBe(true);
    expect((await call('GET', '/v1/me/holds', undefined, a.accessToken)).json).toHaveLength(0);
  });

  it('pays several slots in one order and confirms them all', async () => {
    const a = await newUser('Multi Payer');
    const day = new Date(Date.now() + 6 * 3600_000 + 7 * 86400_000).toISOString().slice(0, 10);
    const free = ((await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}`)).json.slots as Json[]).filter((s) => s.status === 'available');
    const picks = [free[0], free[1], free[2]];
    const hold = await call('POST', '/v1/holds', { slotIds: picks.map((s) => s.id) }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(pay.status).toBe(200);
    const res = await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    expect(res.status).toBe(302);
    expect((await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, a.accessToken)).json.status).toBe('confirmed');
    const mine = (await call('GET', '/v1/me/bookings', undefined, a.accessToken)).json as Json[];
    // Tickets: touching slots merge, so the three slots cover exactly their total time.
    const booked = mine.filter((b) => b.day === day && b.status === 'confirmed');
    expect(booked.reduce((n, b) => n + b.slotCount, 0)).toBe(3);
    expect(booked.reduce((t, b) => t + b.amountPaid, 0)).toBe(picks.reduce((t, p) => t + p.price, 0));
    const after = ((await call('GET', `/v1/venues/v_gulshan_goal/slots?day=${day}`)).json.slots as Json[]).filter((s) => picks.some((p) => p.id === s.id));
    expect(after.every((s) => s.status === 'booked')).toBe(true);
    expect((await call('GET', '/v1/me/holds', undefined, a.accessToken)).json).toEqual([]);
  });
});

d('account: settings, devices, password, deletion', () => {
  const login = async (phone: string, password: string, device: string) =>
    // Sent URL-encoded like the app (header values must be ASCII for Android's HTTP stack).
    signIn(phone, password, { 'x-device': encodeURIComponent(device) });

  it('toggles the notification setting', async () => {
    const a = await newUser('Settings');
    expect((await call('GET', '/v1/me/settings', undefined, a.accessToken)).json).toEqual({ notifications: true, twoFactor: false, hasEmail: true });
    expect((await call('PUT', '/v1/me/settings', { notifications: false }, a.accessToken)).json).toEqual({ notifications: false, twoFactor: false, hasEmail: true });
    expect((await call('PUT', '/v1/me/settings', { other: 1 }, a.accessToken)).status).toBe(400);
  });

  it('lists devices, signs out one, then all others', async () => {
    const a = await newUser('Devices');
    const phone = a.phone;
    const p = (await login(phone, 'correct horse 1', 'iPhone 15 · iOS 18.1')).json;
    const q = (await login(phone, 'correct horse 1', 'Pixel 8 · Android 15')).json;
    const list = (await call('GET', '/v1/me/sessions', undefined, p.accessToken)).json as Json[];
    expect(list.length).toBe(3);
    expect(list.find((s) => s.current)!.device).toBe('iPhone 15 · iOS 18.1');
    const pixel = list.find((s) => s.device === 'Pixel 8 · Android 15')!;
    expect((await call('DELETE', `/v1/me/sessions/${pixel.id}`, undefined, p.accessToken)).status).toBe(200);
    // The signed-out device can't use security actions any more, nor refresh.
    expect((await call('GET', '/v1/me/sessions', undefined, q.accessToken)).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', { refreshToken: q.refreshToken })).status).toBe(401);
    const others = await call('POST', '/v1/me/sessions/revoke-others', {}, p.accessToken);
    expect(others.json.signedOut).toBe(1);
    expect(((await call('GET', '/v1/me/sessions', undefined, p.accessToken)).json as Json[]).length).toBe(1);
    // Still signed in here after a refresh rotation.
    const r = (await call('POST', '/v1/auth/refresh', { refreshToken: p.refreshToken }, undefined, { 'x-device': encodeURIComponent('iPhone 15 · iOS 18.1') })).json;
    expect((await call('GET', '/v1/me/sessions', undefined, r.accessToken)).json[0].current).toBe(true);
  });

  it('changes the password and signs out other devices', async () => {
    const a = await newUser('Passwords');
    const other = (await login(a.phone, 'correct horse 1', 'Old phone')).json;
    expect((await call('POST', '/v1/me/password', { current: 'wrong pass 1', next: 'new horse 22' }, a.accessToken)).status).toBe(400);
    const ok = await call('POST', '/v1/me/password', { current: 'correct horse 1', next: 'new horse 22' }, a.accessToken);
    expect(ok.status).toBe(200);
    expect(ok.json.signedOut).toBe(1);
    expect((await call('POST', '/v1/auth/refresh', { refreshToken: other.refreshToken })).status).toBe(401);
    expect((await login(a.phone, 'correct horse 1', 'x')).status).toBe(401);
    expect((await login(a.phone, 'new horse 22', 'x')).status).toBe(200);
  });

  it('deletes the account: data gone, phone free, sessions ended', async () => {
    const a = await newUser('Leaver');
    await call('PUT', '/v1/me/saved/v_bashundhara', undefined, a.accessToken);
    expect((await call('POST', '/v1/me/delete', { password: 'nope nope 1' }, a.accessToken)).status).toBe(400);
    const del = await call('POST', '/v1/me/delete', { password: 'correct horse 1' }, a.accessToken);
    expect(del.status).toBe(200);
    expect((await call('GET', '/v1/me', undefined, a.accessToken)).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', { refreshToken: a.refreshToken })).status).toBe(401);
    expect((await login(a.phone, 'correct horse 1', 'x')).status).toBe(401);
    // The number is free to sign up again (a taken number answers "already registered" outside prod;
    // 429 here is only the per-number SMS cooldown from this test's own sign-up).
    const again = await call('POST', '/v1/auth/signup/start', { name: 'Comeback', phone: a.phone, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
    expect([200, 429]).toContain(again.status);
    expect(again.json.note).toBeUndefined();
  });

  it('sign-up needs both phone and email, and says clearly when either already has an account', async () => {
    const u = await newUser('Already Here');
    const me = (await call('GET', '/v1/me', undefined, u.accessToken)).json;
    const fresh = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`;
    // Email is required now.
    expect((await call('POST', '/v1/auth/signup/start', { name: 'No Email', phone: phone(), password: 'correct horse 1' })).status).toBe(400);
    // Same number, new email: told it's the number, no code sent.
    const byPhone = await call('POST', '/v1/auth/signup/start', { name: 'Dupe', phone: me.phone, email: fresh(), password: 'correct horse 1' });
    expect(byPhone.status).toBe(409);
    expect(byPhone.json.error).toMatchObject({ code: 'conflict', field: 'phone' });
    expect(byPhone.json.devCode).toBeUndefined();
    // New number, same email (any case): told it's the email.
    const byEmail = await call('POST', '/v1/auth/signup/start', { name: 'Dupe', phone: phone(), email: me.email.toUpperCase(), password: 'correct horse 1' });
    expect(byEmail.status).toBe(409);
    expect(byEmail.json.error).toMatchObject({ code: 'conflict', field: 'email' });
  });

  it('refuses deletion while a game is still ahead', async () => {
    const a = await newUser('Has game');
    const day = new Date(Date.now() + 6 * 3600_000 + 9 * 86400_000).toISOString().slice(0, 10);
    const slot = ((await call('GET', `/v1/venues/v_badda_pitch/slots?day=${day}`)).json.slots as Json[]).find((s) => s.status === 'available')!;
    const hold = await call('POST', '/v1/holds', { slotId: slot.id }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, a.accessToken, { 'Idempotency-Key': randomUUID() });
    await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, a.accessToken);
    const del = await call('POST', '/v1/me/delete', { password: 'correct horse 1' }, a.accessToken);
    expect(del.status).toBe(409);
    expect(del.json.error.message).toMatch(/upcoming booking/);
  });
});
