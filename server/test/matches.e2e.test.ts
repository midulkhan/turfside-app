/**
 * Find players, end to end: post open spots on a paid booking → request → accept → pay share
 * (simulated bKash) → in the squad. Plus the 10-per-page lists.
 *   API_URL=… (BKASH_MODE=simulate) npm test
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

d('find players', () => {
  let org: Awaited<ReturnType<typeof newUser>>;
  let p1: Awaited<ReturnType<typeof newUser>>;
  let p2: Awaited<ReturnType<typeof newUser>>;
  let p3: Awaited<ReturnType<typeof newUser>>;
  let bookingId = '';
  let matchId = '';
  let pushToken = '';
  beforeAll(async () => {
    [org, p1, p2, p3] = await Promise.all([newUser('Organiser One'), newUser('Tanvir Ahmed'), newUser('Rafi Islam'), newUser('Sami Khan')]);
    bookingId = await paidBooking(org.accessToken, 'v_kickoff_uttara', 6);
  });

  it('organiser opens spots on a paid booking; price per player is fixed by the server', async () => {
    // Before: the paid booking is offered as one that can take players.
    const before = (await call('GET', '/v1/matches/mine', undefined, org.accessToken)).json;
    expect(before.bookings.map((b: Json) => b.id)).toContain(bookingId);
    // The organiser may share a different number for this squad; it must be a valid mobile number.
    const bad = await call('POST', '/v1/matches', { bookingId, level: 'casual', openSpots: 3, sharePhone: true, contactPhone: '12345' }, org.accessToken);
    expect(bad.status).toBe(400);
    const r = await call('POST', '/v1/matches', { bookingId, level: 'casual', openSpots: 3, title: 'Evening five-a-side', sharePhone: true, contactPhone: '01799000111' }, org.accessToken);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    matchId = r.json.id;
    expect(r.json.my).toBe('owner');
    expect(r.json.openSpots).toBe(3);
    expect(r.json.playersIn).toBe(r.json.playersTotal - 3);
    const booking = (await call('GET', `/v1/bookings/${bookingId}`, undefined, org.accessToken)).json;
    expect(r.json.share).toBe(Math.ceil(booking.amountPaid / r.json.playersTotal / 100) * 100);
    expect(booking.matchId).toBe(matchId);
    const after = (await call('GET', '/v1/matches/mine', undefined, org.accessToken)).json;
    expect(after.matches.map((m: Json) => m.id)).toContain(matchId);
    expect(after.bookings.map((b: Json) => b.id)).not.toContain(bookingId);
    expect((await call('GET', '/v1/matches/mine', undefined, p1.accessToken)).json.matches).toEqual([]);
    // Again: same match, not a second one.
    expect((await call('POST', '/v1/matches', { bookingId, level: 'casual', openSpots: 3, sharePhone: true }, org.accessToken)).json.id).toBe(matchId);
    // The booked slot on the turf page now advertises the squad (and who is the host).
    const slotOf = async (token?: string) =>
      ((await call('GET', `/v1/venues/v_kickoff_uttara/slots?day=${dayIn(6)}`, undefined, token)).json.slots as Json[]).find((x) => x.squad);
    const seen = await slotOf();
    expect(seen).toMatchObject({ status: 'booked', squad: { id: matchId, spotsLeft: 3 } });
    expect(seen!.squad.host).toBeUndefined();
    expect((await slotOf(org.accessToken))!.squad.host).toBe(true);
    // Someone else's booking can't be used.
    expect((await call('POST', '/v1/matches', { bookingId, level: 'casual', openSpots: 2, sharePhone: true }, p1.accessToken)).status).toBe(404);
  });

  it('players find it and ask to join; the organiser sees the requests', async () => {
    // The organiser's phone is registered for push; junk tokens are refused.
    const orgToken = `ExponentPushToken[org-${randomUUID().slice(0, 12)}]`;
    expect((await call('PUT', '/v1/me/push-token', { token: 'not-a-token', platform: 'ios' }, org.accessToken)).status).toBe(400);
    expect((await call('PUT', '/v1/me/push-token', { token: orgToken, platform: 'android' }, org.accessToken)).status).toBe(200);
    pushToken = orgToken;
    const feed = (await call('GET', '/v1/matches?lat=23.87&lng=90.40', undefined, p1.accessToken)).json;
    const item = feed.items.find((m: Json) => m.id === matchId);
    expect(item.my).toBe('none');
    expect(item.spotsLeft).toBe(3);
    expect(item.faces[0].name).toBe('Organiser One');
    // Asking without agreeing to share your number (after paying, with the organiser only): refused.
    const noConsent = await call('POST', `/v1/matches/${matchId}/join`, { position: 'midfielder' }, p1.accessToken);
    expect(noConsent.status).toBe(400);
    // More spots than are open: refused, nothing recorded.
    expect((await call('POST', `/v1/matches/${matchId}/join`, { spots: 4, sharePhone: true }, p1.accessToken)).status).toBe(409);
    const asked = (await call('POST', `/v1/matches/${matchId}/join`, { position: 'midfielder', level: 'casual', spots: 2, sharePhone: true }, p1.accessToken)).json;
    expect(asked).toMatchObject({ my: 'pending', mySpots: 2 });
    expect((await call('POST', `/v1/matches/${matchId}/join`, { position: 'goalkeeper', level: 'regular', sharePhone: true }, p2.accessToken)).json.my).toBe('pending');
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true }, org.accessToken)).status).toBe(403); // own match
    // Each request reached the organiser's phone as a push, with what the app needs to open it.
    const pushes = (await call('GET', '/v1/test/pushes')).json.sent as Json[];
    const mine = pushes.filter((p) => p.to === pushToken);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]).toMatchObject({ title: 'New request to join', channelId: 'default', data: { type: 'match_request', matchId } });
    expect(new Set(mine.map((p) => p.data.notificationId)).size).toBe(mine.length); // each notification pushed once
    const m = (await call('GET', `/v1/matches/${matchId}/manage`, undefined, org.accessToken)).json;
    expect(m.requests.map((x: Json) => x.name).sort()).toEqual(['Rafi Islam', 'Tanvir Ahmed']);
    expect((await call('GET', `/v1/matches/${matchId}/manage`, undefined, p1.accessToken)).status).toBe(404); // not theirs
    const n = (await call('GET', '/v1/me/notifications', undefined, org.accessToken)).json as Json[];
    expect(n.some((x) => x.data?.type === 'match_request' && x.data.matchId === matchId)).toBe(true);
  });

  it('accept → notification with pay → pay share via bKash → in the squad', async () => {
    const acc = await call('POST', `/v1/matches/${matchId}/requests/${p1.user.id}/accept`, undefined, org.accessToken);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    expect(acc.json.squad[0]).toMatchObject({ name: 'Tanvir Ahmed', paid: false, spots: 2 });
    const note = ((await call('GET', '/v1/me/notifications', undefined, p1.accessToken)).json as Json[]).find((x) => x.data?.type === 'match_accepted');
    expect(note?.data.matchId).toBe(matchId);
    const mine = (await call('GET', `/v1/matches/${matchId}`, undefined, p1.accessToken)).json;
    expect(mine.my).toBe('accepted');
    expect(mine.payBy).toBeGreaterThan(Date.now());
    expect(mine.payBy).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 5_000); // 5-minute pay window
    // Held spots are off the market for everyone else, and the release time is public.
    const other = (await call('GET', `/v1/matches/${matchId}`, undefined, p3.accessToken)).json;
    expect(other.spotsLeft).toBe(1);
    expect(other.reservedUntil).toBe(mine.payBy);
    // Only the accepted player can pay, only their share.
    expect((await call('POST', `/v1/matches/${matchId}/pay`, {}, p2.accessToken, { 'Idempotency-Key': randomUUID() })).status).toBe(410);
    const pay = await call('POST', `/v1/matches/${matchId}/pay`, {}, p1.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(pay.status, JSON.stringify(pay.json)).toBe(200);
    await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    const st = (await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, p1.accessToken)).json;
    expect(st).toMatchObject({ status: 'confirmed', kind: 'share', matchId });
    const after = (await call('GET', `/v1/matches/${matchId}`, undefined, p1.accessToken)).json;
    expect(after.my).toBe('paid');
    expect(after.playersIn).toBe(after.playersTotal - 1);
    expect(after.spotsLeft).toBe(1);
    // It's listed with their bookings, with the spots they paid for; not for others.
    const mineJoined = (await call('GET', '/v1/matches/joined', undefined, p1.accessToken)).json as Json[];
    expect(mineJoined.find((x) => x.id === matchId)).toMatchObject({ my: 'paid', mySpots: 2 });
    expect((await call('GET', '/v1/matches/joined', undefined, p2.accessToken)).json).toEqual([]);
    // The organiser's booking is untouched by a share payment.
    const hostTicket = (await call('GET', `/v1/bookings/${bookingId}`, undefined, org.accessToken)).json;
    expect(hostTicket.status).toBe('confirmed');
    // A paid player sees the organiser's entry pass (same code and QR); nobody else does.
    expect(after.pass).toEqual({ code: hostTicket.code, passToken: hostTicket.passToken });
    expect(after.pass.passToken).toMatch(/^TSP2\./);
    expect((await call('GET', `/v1/matches/${matchId}`, undefined, p2.accessToken)).json.pass).toBeUndefined();
    expect((await call('GET', `/v1/matches/${matchId}`)).json.pass).toBeUndefined();
    // Phone numbers: the paid player gets the organiser's; the organiser gets paid players' only;
    // nobody else gets any, and no player ever sees another player's number.
    // …the squad number they chose, not their account number.
    expect(after.host).toEqual({ name: 'Organiser One', phone: '+8801799000111' });
    expect(JSON.stringify(after)).not.toContain(org.user.phone);
    for (const viewer of [p2, p3]) {
      const seen = (await call('GET', `/v1/matches/${matchId}`, undefined, viewer.accessToken)).json;
      expect(seen.host).toBeUndefined();
      expect(JSON.stringify(seen)).not.toContain(org.user.phone);
      expect(JSON.stringify(seen)).not.toContain(p1.user.phone);
    }
    expect(JSON.stringify(after)).not.toContain(p2.user.phone);
    const managed = (await call('GET', `/v1/matches/${matchId}/manage`, undefined, org.accessToken)).json;
    expect(managed.squad.find((x: Json) => x.userId === p1.user.id).phone).toBe(p1.user.phone);
    expect(JSON.stringify(managed.requests)).not.toContain(p2.user.phone); // asked, not paid: hidden
    expect(((await call('GET', '/v1/me/notifications', undefined, org.accessToken)).json as Json[]).some((x) => x.data?.type === 'match_member_paid')).toBe(true);
  });

  it('decline, pause and the last spot', async () => {
    expect((await call('POST', `/v1/matches/${matchId}/requests/${p2.user.id}/decline`, undefined, org.accessToken)).status).toBe(200);
    expect((await call('GET', `/v1/matches/${matchId}`, undefined, p2.accessToken)).json.my).toBe('declined');
    // A no isn't final: they can ask again (only for what's left).
    expect((await call('POST', `/v1/matches/${matchId}/join`, { spots: 2, sharePhone: true }, p2.accessToken)).status).toBe(409);
    expect((await call('POST', `/v1/matches/${matchId}/join`, { spots: 1, sharePhone: true }, p2.accessToken)).json).toMatchObject({ my: 'pending', mySpots: 1 });
    const paused = await call('PATCH', `/v1/matches/${matchId}`, { paused: true }, org.accessToken);
    expect(paused.json.status).toBe('paused');
    // Paused: the slot shows plain "Booked" again.
    const pausedSlots = (await call('GET', `/v1/venues/v_kickoff_uttara/slots?day=${dayIn(6)}`)).json.slots as Json[];
    expect(pausedSlots.some((x) => x.squad)).toBe(false);
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true }, p3.accessToken)).status).toBe(403);
    expect((await call('PATCH', `/v1/matches/${matchId}`, { paused: false }, org.accessToken)).json.status).toBe('open');
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true }, p3.accessToken)).json.my).toBe('pending');
    expect((await call('DELETE', `/v1/matches/${matchId}/join`, undefined, p3.accessToken)).json.my).toBe('withdrawn');
  });

  it('pages: matches, turfs and bookings come 10 at a time with a cursor', async () => {
    const page = (await call('GET', '/v1/matches?limit=1', undefined, p1.accessToken)).json;
    expect(page.items).toHaveLength(1);
    const ex1 = (await call('GET', '/v1/venues/explore?lat=23.79&lng=90.40&radius=50&limit=2')).json;
    expect(ex1.near.length + ex1.further.length).toBe(2);
    expect(ex1.nextCursor).toBe(2);
    const ex2 = (await call('GET', `/v1/venues/explore?lat=23.79&lng=90.40&radius=50&limit=2&cursor=2`)).json;
    const ids1 = [...ex1.near, ...ex1.further].map((v: Json) => v.id);
    const ids2 = [...ex2.near, ...ex2.further].map((v: Json) => v.id);
    expect(ids2.some((id) => ids1.includes(id))).toBe(false);
    // Old clients (no limit) still get the single response.
    expect((await call('GET', '/v1/venues/explore?lat=23.79&lng=90.40')).json.nextCursor).toBeUndefined();
    const bk = (await call('GET', '/v1/me/bookings?limit=10&filter=open', undefined, org.accessToken)).json;
    expect(bk.items[0].id).toBe(bookingId);
    expect(bk.next.id).toBe(bookingId);
    expect(Array.isArray((await call('GET', '/v1/me/bookings', undefined, org.accessToken)).json)).toBe(true);
  });

  it('push respects the notifications switch and stops at logout', async () => {
    const count = async () => ((await call('GET', '/v1/test/pushes')).json.sent as Json[]).filter((p) => p.to === pushToken).length;
    const before = await count();
    // Switched off: news is still listed in the app, but the phone isn't buzzed.
    expect((await call('PUT', '/v1/me/settings', { notifications: false }, org.accessToken)).status).toBe(200);
    const listed = async () => ((await call('GET', '/v1/me/notifications', undefined, org.accessToken)).json as Json[]).length;
    const inApp = await listed();
    const rejoin = await call('POST', `/v1/matches/${matchId}/join`, { position: 'defender', level: 'casual', sharePhone: true }, p3.accessToken);
    expect(rejoin.status, JSON.stringify(rejoin.json)).toBe(200);
    expect(await listed()).toBe(inApp + 1); // the news is there in the app…
    expect(await count()).toBe(before); // …but no push went out
    expect((await call('PUT', '/v1/me/settings', { notifications: true }, org.accessToken)).status).toBe(200);
    // Removing the token (sign-out on that phone) stops pushes to it.
    expect((await call('DELETE', '/v1/me/push-token', { token: pushToken }, org.accessToken)).status).toBe(200);
    await call('DELETE', `/v1/matches/${matchId}/join`, undefined, p3.accessToken);
    await call('POST', `/v1/matches/${matchId}/join`, { position: 'defender', level: 'casual', sharePhone: true }, p3.accessToken);
    expect(await count()).toBe(before);
  });

  it('cancelling the booking cancels the match and flags the paid share for refund', async () => {
    const c = await call('POST', `/v1/bookings/${bookingId}/cancel`, undefined, org.accessToken);
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    expect((await call('GET', `/v1/matches/${matchId}`, undefined, p1.accessToken)).status).toBe(404);
    expect(((await call('GET', '/v1/me/notifications', undefined, p1.accessToken)).json as Json[]).some((x) => x.data?.type === 'match_cancelled')).toBe(true);
  });
});
