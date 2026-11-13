/**
 * The mobile app's own API client (src/features/api/client.ts) against a running server.
 *   API_URL=http://localhost:4010 npx vitest run test/app
 */
import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;

type Api = typeof import('../../../src/features/api/client');
type Tokens = typeof import('../../../src/features/api/tokens');
let api: Api;
let tokens: Tokens['tokens'];
let ApiError: typeof import('../../../src/features/api/types').ApiError;

const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const addDays = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

d('mobile app client ↔ live API', () => {
  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_URL = API;
    api = await import('../../../src/features/api/client');
    tokens = (await import('../../../src/features/api/tokens')).tokens;
    ApiError = (await import('../../../src/features/api/types')).ApiError;
  });

  it('sends only ASCII header values (Android rejects the whole request otherwise)', async () => {
    const http = await import('../../../src/features/api/http');
    http.setDeviceLabel('Pixel 8 · Android 15 — Café'); // "·", "—", "é" are all non-ASCII
    const seen: Record<string, string>[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return real(input, init);
    }) as typeof fetch;
    try {
      await api.getConfig();
    } finally {
      globalThis.fetch = real;
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const h of seen) for (const [k, v] of Object.entries(h)) expect(`${k}: ${v}`).toMatch(/^[\x20-\x7E]*$/);
    expect(decodeURIComponent(seen[0]['x-device'])).toBe('Pixel 8 · Android 15 — Café');
  });

  it('reads public config', async () => {
    const c = await api.getConfig();
    expect(c.paymentsEnabled).toBe(true);
    expect(c.horizonDays).toBeGreaterThan(0);
  });

  it('signs up with an SMS code and stores tokens', async () => {
    const sent = await api.signupStart({ name: 'App Tester', phone, email: `app${Date.now().toString(36)}@test.turfsides.dev`, password: 'app password 1' });
    expect(sent.devCode).toMatch(/^\d{6}$/);
    await expect(api.signupVerify(phone, '000000')).rejects.toBeInstanceOf(ApiError);
    const auth = await api.signupVerify(phone, sent.devCode!);
    expect(auth.user.phone).toBe(phone);
    await tokens.set(auth.accessToken, auth.refreshToken);
    expect((await api.me()).name).toBe('App Tester');
  });

  it('refreshes an expired access token transparently', async () => {
    const oldRefresh = tokens.refresh!;
    await tokens.set('not-a-valid-jwt', oldRefresh);
    expect((await api.me()).phone).toBe(phone); // 401 → refresh → retry
    expect(tokens.refresh).not.toBe(oldRefresh); // rotated
  });

  let venueId = '';
  it('explores, opens a venue, reviews and slots', async () => {
    const ex = await api.explore({ lat: 23.8191, lng: 90.4526, day: addDays(0), format: 'any' });
    const all = [...ex.near, ...ex.further];
    expect(all.length).toBeGreaterThan(0);
    venueId = all[0].id;
    expect(all[0].photo).toMatch(/^https?:\/\/.+\.webp$/);
    const v = await api.getVenue(venueId);
    expect(v.photos.length).toBeGreaterThan(0);
    const rv = await api.getReviews(venueId);
    expect(rv.count).toBeGreaterThanOrEqual(0);
    const s = await api.getSlots(venueId, addDays(3));
    expect(s.slots.some((x) => x.status === 'available')).toBe(true);
    await expect(api.getVenue('v_missing')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('saves and unsaves a turf', async () => {
    await api.setSaved(venueId, true);
    expect((await api.getSaved()).map((v) => v.id)).toContain(venueId);
    expect((await api.getVenue(venueId)).isSaved).toBe(true);
    await api.setSaved(venueId, false);
    expect((await api.getSaved()).map((v) => v.id)).not.toContain(venueId);
  });

  let bookingId = '';
  it('holds a slot, pays through bKash (simulated) and gets a confirmed booking', async () => {
    const day = addDays(3);
    const slot = (await api.getSlots(venueId, day)).slots.find((s) => s.status === 'available')!;
    const key = `app-test-${Date.now()}`;
    const hold = await api.createHold(slot.id, key);
    expect(await api.createHold(slot.id, key)).toEqual(hold); // idempotent retry
    expect(hold.total).toBeGreaterThan(0);
    expect((await api.getHold(hold.holdId)).holdId).toBe(hold.holdId);
    expect((await api.getSlots(venueId, day)).slots.find((s) => s.id === slot.id)).toMatchObject({ status: 'mine', holdId: hold.holdId });

    const returnUrl = 'exp://192.168.0.5:8081/--/payment-return';
    const pay = await api.startPayment(hold.holdId, `pay-${Date.now()}`, returnUrl);
    expect(pay.checkoutUrl).toContain('/v1/payments/simulate/');
    expect((await api.getPaymentStatus(pay.paymentId)).status).toBe('pending');

    // What the in-app browser does on the bKash page:
    const res = await fetch(pay.checkoutUrl!, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^exp:\/\/192\.168\.0\.5:8081\/--\/payment-return\?paymentId=.+&status=confirmed$/);

    const st = await api.getPaymentStatus(pay.paymentId);
    expect(st.status).toBe('confirmed');
    bookingId = st.bookingId!;
    const b = await api.getBooking(bookingId);
    expect(b.status).toBe('confirmed');
    expect(b.passToken).toMatch(/^TSP2\./);
    expect(b.amountPaid).toBe(hold.total);
    expect((await api.getBookings()).map((x) => x.id)).toContain(bookingId);
    expect((await api.getNotifications()).some((n) => n.kind === 'payment')).toBe(true);
    expect(await api.getRequests()).toEqual([]);
  });

  it('rejects a foreign return URL (open-redirect guard)', async () => {
    const slot = (await api.getSlots(venueId, addDays(4))).slots.find((s) => s.status === 'available')!;
    const hold = await api.createHold(slot.id, `app-test2-${Date.now()}`);
    const pay = await api.startPayment(hold.holdId, `pay2-${Date.now()}`, 'https://evil.example/steal');
    const res = await fetch(pay.checkoutUrl!, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=cancel' });
    expect(res.headers.get('location')).toMatch(/^turfsides:\/\/payment-return\?.*status=cancel/);
    expect((await api.getPaymentStatus(pay.paymentId)).status).toBe('failed');
  });

  it('cancels a booking more than 24 h ahead', async () => {
    await api.cancelBooking(bookingId);
    const b = await api.getBooking(bookingId);
    expect(b.status).toBe('cancelled');
    expect(b.passToken).toBe('');
  });

  it('resets the password, then signs in with it', async () => {
    const sent = await api.resetStart(phone);
    const auth = await api.resetVerify(phone, sent.devCode!, 'brand new pass 2');
    await tokens.set(auth.accessToken, auth.refreshToken);
    await expect(api.login(phone, 'app password 1')).rejects.toMatchObject({ code: 'unauthorized' });
    const step1 = await api.login(`0${phone}`, 'brand new pass 2');
    expect(step1.otpRequired).toBe(true);
    const again = await api.loginVerify(step1.challenge, step1.devCode!);
    expect(again.user.phone).toBe(phone);
    await tokens.set(again.accessToken, again.refreshToken);
  });

  it('logout revokes the session', async () => {
    const rt = tokens.refresh!;
    await api.logout();
    await tokens.set('expired', rt);
    let expired = false;
    const off = tokens.onExpired(() => (expired = true));
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
    off();
    expect(expired).toBe(true);
    expect(tokens.refresh).toBeNull();
  });
});
