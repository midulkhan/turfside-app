/**
 * End-to-end tests against a running API (staging, BKASH_MODE=simulate).
 *   API_URL=http://localhost:4010 npm test
 */
import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;

type Json = Record<string, any>;
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

const phone = () => `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function newUser(name = 'Test Player') {
  const p = phone();
  const start = await call('POST', '/v1/auth/signup/start', { name, phone: p, password: 'correct horse 1' });
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

  it('auth: login, wrong password, refresh rotation with reuse detection', async () => {
    const bad = await call('POST', '/v1/auth/login', { identifier: a.phone, password: 'nope-nope' });
    expect(bad.status).toBe(401);
    const ok = await call('POST', '/v1/auth/login', { identifier: `+880${a.phone}`, password: 'correct horse 1' });
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
    await call('POST', '/v1/auth/signup/start', { name: 'Otp Test', phone: p, password: 'password123' });
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
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, b.accessToken, { 'Idempotency-Key': payKey });
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
    expect(booking.json.passToken).toMatch(/^tsp1\./);
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
