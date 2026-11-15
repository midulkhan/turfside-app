/**
 * The cache saves database work without ever serving a wrong answer.
 *   API_URL=… [API_URL_2=… second process on the same DB + Redis] DATABASE_URL=… npm test
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const API2 = process.env.API_URL_2;
const d = API ? describe : describe.skip;
type Json = Record<string, any>;

async function call(base: string, method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json, db: Number(res.headers.get('x-db-queries') ?? NaN) };
}

async function newUser() {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const start = await call(API!, 'POST', '/v1/auth/signup/start', { name: 'Cache Test', phone, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
  return (await call(API!, 'POST', '/v1/auth/signup/verify', { phone, code: start.json.devCode })).json as { accessToken: string };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

d('cache', () => {
  const venue = 'v_mirpur_dome';
  const day = dayIn(9);
  let token = '';
  beforeAll(async () => {
    token = (await newUser()).accessToken;
  });

  it('serves the turf page and reviews from cache, but always reads slot status live', async () => {
    const reads = [`/v1/venues/${venue}`, `/v1/venues/${venue}/reviews`];
    for (const r of reads) expect((await call(API!, 'GET', r)).status).toBe(200); // warm
    for (const r of reads) expect((await call(API!, 'GET', r)).db, r).toBe(0);
    // Availability (slots, and explore's "available" badge) is never cached: one live query each time.
    for (const r of [`/v1/venues/${venue}/slots?day=${day}`, `/v1/venues/explore?lat=23.79&lng=90.40&day=${day}&radius=20`]) {
      await call(API!, 'GET', r);
      const res = await call(API!, 'GET', r);
      expect(res.status).toBe(200);
      expect(res.db, r).toBe(1);
    }
  });

  it('shows a new hold at once, read live from the database', async () => {
    const slots = (await call(API!, 'GET', `/v1/venues/${venue}/slots?day=${day}`)).json.slots as Json[];
    const slot = slots.find((s) => s.status === 'available')!;
    const hold = await call(API!, 'POST', '/v1/holds', { slotId: slot.id }, token, { 'Idempotency-Key': randomUUID() });
    expect(hold.status).toBe(200);
    const read = await call(API!, 'GET', `/v1/venues/${venue}/slots?day=${day}`);
    const seen = read.json.slots as Json[];
    expect(seen.find((s) => s.id === slot.id)!.status).toBe('held');
    expect(read.db).toBe(1); // live read, no cached copy
    // Explore agrees with the turf page.
    const ex = (await call(API!, 'GET', `/v1/venues/explore?lat=23.79&lng=90.40&day=${day}&radius=50`)).json;
    const card = [...ex.near, ...ex.further].find((v: Json) => v.id === venue);
    expect(card.availableToday).toBe(seen.some((s) => s.status === 'available'));
    // Giving it back frees it straight away.
    expect((await call(API!, 'DELETE', `/v1/holds/${hold.json.holdId}`, undefined, token)).status).toBe(200);
    const after = (await call(API!, 'GET', `/v1/venues/${venue}/slots?day=${day}`)).json.slots as Json[];
    expect(after.find((s) => s.id === slot.id)!.status).toBe('available');
  });

  it('starting a bKash payment keeps the slot held in the cache for the whole payment window', async () => {
    const d2 = dayIn(10);
    const slot = ((await call(API!, 'GET', `/v1/venues/${venue}/slots?day=${d2}`)).json.slots as Json[]).find((s) => s.status === 'available')!;
    const hold = await call(API!, 'POST', '/v1/holds', { slotId: slot.id }, token, { 'Idempotency-Key': randomUUID() });
    const pay = await call(API!, 'POST', '/v1/payments', { holdId: hold.json.holdId }, token, { 'Idempotency-Key': randomUUID() });
    expect(pay.status).toBe(200);
    const s = (await call(API!, 'GET', `/v1/venues/${venue}/slots?day=${d2}`)).json.slots as Json[];
    expect(s.find((x) => x.id === slot.id)!.status).toBe('held');
  });

  const dbUrl = process.env.DATABASE_URL;
  const two = API2 && dbUrl ? it : it.skip;
  let db: pg.Client | null = null;
  afterAll(async () => db?.end());

  two('another server process serves the change as soon as the realtime transaction id is passed', async () => {
    db = new pg.Client({ connectionString: dbUrl, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
    await db.connect();
    const d3 = dayIn(11);
    const path = `/v1/venues/${venue}/slots?day=${d3}`;
    // Process 2 has this day in memory before the change…
    const slot = ((await call(API2!, 'GET', path)).json.slots as Json[]).find((s) => s.status === 'available')!;
    // …the hold happens on process 1…
    const hold = await call(API!, 'POST', '/v1/holds', { slotId: slot.id }, token, { 'Idempotency-Key': randomUUID() });
    expect(hold.status).toBe(200);
    // …and the realtime row carries the transaction id the app passes back.
    const xid = (await db.query<{ xid: string }>('select xid::text from slot_updates where venue_id = $1 and day = $2', [venue, d3])).rows[0].xid;
    expect(xid).toMatch(/^\d+$/);
    const s = (await call(API2!, 'GET', `${path}&v=${xid}`)).json.slots as Json[];
    expect(s.find((x) => x.id === slot.id)!.status).toBe('held');
    // Without the id, process 2 catches up within its 2-second memory window.
    await new Promise((r) => setTimeout(r, 2100));
    const plain = (await call(API2!, 'GET', path)).json.slots as Json[];
    expect(plain.find((x) => x.id === slot.id)!.status).toBe('held');
    await call(API!, 'DELETE', `/v1/holds/${hold.json.holdId}`, undefined, token);
  });

  two('a price change applies to the next hold at once, even on a process that has the old price in memory', async () => {
    const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const start = await call(API!, 'POST', '/v1/owner/auth/signup/start', { name: 'Cache Owner', phone, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
    const owner = (await call(API!, 'POST', '/v1/owner/auth/signup/verify', { phone, code: start.json.devCode })).json as { accessToken: string };
    const turf = {
      name: `Cache Arena ${randomUUID().slice(0, 6)}`, area: 'Banani', city: 'Dhaka', address: 'Road 1, Banani', lat: 23.79, lng: 90.4,
      formats: ['5-a-side'], floodlit: true, amenities: [], rules: [], about: 'Price test turf for the cache suite.',
      schedule: { opens: '06:00', closes: '23:00', sessionMinutes: 60, breakMinutes: 0 },
      pricing: { hourly: 2000, byWeekday: {}, specialDates: {} }, photos: ['/static/seed/venue-arena.webp'],
    };
    const made = await call(API!, 'POST', '/v1/owner/venues', turf, owner.accessToken);
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const id = made.json.id as string;
    const d4 = dayIn(12);
    // Process 2 loads the catalog (and so the turf at ৳2000/h); wait out its once-a-minute
    // re-check only if this is the first time it sees the turf.
    let s2 = await call(API2!, 'GET', `/v1/venues/${id}/slots?day=${d4}`);
    for (let i = 0; s2.status !== 200 && i < 70; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      s2 = await call(API2!, 'GET', `/v1/venues/${id}/slots?day=${d4}`);
    }
    expect(s2.json.slots[0].price).toBe(200_000);
    // Owner raises the price on process 1.
    expect((await call(API!, 'PUT', `/v1/owner/venues/${id}`, { ...turf, pricing: { hourly: 3000, byWeekday: {}, specialDates: {} } }, owner.accessToken)).status).toBe(200);
    expect((await call(API!, 'GET', `/v1/venues/${id}/slots?day=${d4}`)).json.slots[0].price).toBe(300_000);
    // A player holding through process 2 is charged the new price, never the remembered one.
    const hold = await call(API2!, 'POST', '/v1/holds', { slotId: s2.json.slots[0].id }, token, { 'Idempotency-Key': randomUUID() });
    expect(hold.status, JSON.stringify(hold.json)).toBe(200);
    expect(hold.json.total).toBe(300_000);
    await call(API!, 'DELETE', `/v1/holds/${hold.json.holdId}`, undefined, token);
  }, 90_000);
});
