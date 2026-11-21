/**
 * Owner dashboard API (/v1/owner/*): flexible sessions and time-band prices as players see and
 * pay them, walk-ins, closures, owner cancel/check-in, stats, tournaments, inbox, and isolation.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
async function newUser(role: 'player' | 'owner') {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const A = role === 'owner' ? '/v1/owner/auth' : '/v1/auth';
  const s = await call('POST', `${A}/signup/start`, {
    name: `Dash ${role}`,
    phone,
    email: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`,
    password: 'owner pass 123',
    role,
  });
  return (await call('POST', `${A}/signup/verify`, { phone, code: s.json.devCode })).json as { accessToken: string; user: Json };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const dow = (day: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${day}T00:00:00Z`).getUTCDay()]!;

const base = {
  name: 'Dashboard Test Arena',
  area: 'Gulshan',
  city: 'Dhaka',
  address: 'Road 90, Gulshan 2, Dhaka',
  lat: 23.79,
  lng: 90.41,
  formats: ['5-a-side'],
  schedule: { opens: '07:00', closes: '23:00', sessionMinutes: 90, breakMinutes: 0 },
  pricing: { hourly: 1200 },
};

async function payFor(token: string, slotIds: string[]) {
  const hold = await call('POST', '/v1/holds', { slotIds }, token);
  expect(hold.status, JSON.stringify(hold.json)).toBe(200);
  const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId }, token, { 'Idempotency-Key': randomUUID() });
  await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=pay',
  });
  const st = await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, token);
  expect(st.json.status).toBe('confirmed');
  return { hold: hold.json, bookingId: st.json.bookingId as string };
}

d('owner dashboard', () => {
  it('fixed 90-minute sessions with time-band prices: players see and pay the same price', async () => {
    const o = await newUser('owner');
    const day = dayIn(3);
    const v = await call(
      'POST',
      '/v1/owner/venues',
      {
        ...base,
        priceBands: [
          { from: '07:00', to: '10:00', hourly: 1000 },
          { from: '17:00', to: '23:00', hourly: 2000, days: [dow(day)] },
        ],
      },
      o.accessToken,
    );
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect(v.json.priceBands).toEqual([
      { from: '07:00', to: '10:00', hourly: 1000, days: [] },
      { from: '17:00', to: '23:00', hourly: 2000, days: [dow(day)] },
    ]);
    expect(v.json.slots).toEqual({ mode: 'fixed', custom: [] });

    const slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.map((s) => s.start)).toEqual([420, 510, 600, 690, 780, 870, 960, 1050, 1140, 1230]);
    expect(slots[0].price).toBe(150000); // 07:00, ৳1000/h × 1.5 h
    expect(slots[1].price).toBe(150000); // 08:30 starts inside the morning band
    expect(slots[2].price).toBe(180000); // 10:00 standard ৳1200/h
    expect(slots[7].price).toBe(300000); // 17:30 evening band
    // The band only applies on its weekday.
    const other = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${dayIn(4)}`)).json.slots as Json[];
    expect(other[7].price).toBe(180000);

    // Explore shows the lowest hourly rate.
    const detail = (await call('GET', `/v1/venues/${v.json.id}`)).json;
    expect(detail.hourlyFrom).toBe(100000);

    // Hold price is computed by the server with the same rules.
    const p = await newUser('player');
    const hold = await call('POST', '/v1/holds', { slotIds: [slots[7].id] }, p.accessToken);
    expect(hold.json.slots[0].price).toBe(300000);

    // An update that leaves the new fields out keeps them (older owner clients).
    const again = await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, pricing: { hourly: 1300 } }, o.accessToken);
    expect(again.json.priceBands).toHaveLength(2);
    expect(again.json.pricing.hourly).toBe(1300);
  });

  it('custom sessions with their own prices', async () => {
    const o = await newUser('owner');
    const v = await call(
      'POST',
      '/v1/owner/venues',
      {
        ...base,
        schedule: { opens: '07:00', closes: '01:00', sessionMinutes: 60, breakMinutes: 0 },
        slots: {
          mode: 'custom',
          custom: [
            { start: '07:00', end: '08:30', price: 1500 },
            { start: '18:00', end: '19:00' },
            { start: '23:30', end: '01:00', price: 2600 },
          ],
        },
      },
      o.accessToken,
    );
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect(v.json.slots.custom).toEqual([
      { start: '07:00', end: '08:30', price: 1500 },
      { start: '18:00', end: '19:00', price: null },
      { start: '23:30', end: '01:00', price: 2600 },
    ]);
    const day = dayIn(2);
    const slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.map((s) => [s.start, s.end, s.price])).toEqual([
      [420, 510, 150000],
      [1080, 1140, 120000],
      [1410, 1500, 260000],
    ]);
    const p = await newUser('player');
    const hold = await call('POST', '/v1/holds', { slotIds: [slots[2].id] }, p.accessToken);
    expect(hold.status).toBe(200);
    expect(hold.json.slots[0].price).toBe(260000);

    const overlap = await call(
      'PUT',
      `/v1/owner/venues/${v.json.id}`,
      {
        ...base,
        slots: {
          mode: 'custom',
          custom: [
            { start: '07:00', end: '09:00' },
            { start: '08:30', end: '10:00' },
          ],
        },
      },
      o.accessToken,
    );
    expect(overlap.status).toBe(400);
    expect(overlap.json.error.message).toMatch(/overlaps/);
  });

  it('walk-ins, closures, owner cancel and check-in, stats and inbox', async () => {
    const o = await newUser('owner');
    const v = (await call('POST', '/v1/owner/venues', base, o.accessToken)).json;
    const day = dayIn(5);
    const sheet = (await call('GET', `/v1/owner/venues/${v.id}/day?day=${day}`, undefined, o.accessToken)).json;
    expect(sheet.sessions).toHaveLength(10);
    expect(sheet.sessions[0]).toMatchObject({ start: 420, end: 510, price: 1800, status: 'available' });

    // Walk-in takes the 07:00 session at a discount; players see it booked.
    const walk = await call(
      'POST',
      '/v1/owner/bookings',
      { venueId: v.id, day, starts: [420, 510], guestName: 'Rahim', guestPhone: '01711000000', guestEmail: 'rahim@walkin.test', amount: 3000 },
      o.accessToken,
    );
    expect(walk.status, JSON.stringify(walk.json)).toBe(200);
    expect(walk.json.bookings.map((b: Json) => b.amount)).toEqual([1500, 1500]);
    expect(walk.json.bookings[0]).toMatchObject({ source: 'walkin', status: 'confirmed', customer: { name: 'Rahim', guest: true } });
    const slots = (await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots[0].status).toBe('booked');
    const p = await newUser('player');
    expect((await call('POST', '/v1/holds', { slotIds: [slots[0].id] }, p.accessToken)).status).toBe(409);
    expect(
      (await call('POST', '/v1/owner/bookings', { venueId: v.id, day, starts: [420], guestName: 'Karim', guestPhone: '01711000001', guestEmail: 'karim@walkin.test' }, o.accessToken)).status,
    ).toBe(409);

    // A player pays for 13:00 in the app.
    const { bookingId } = await payFor(p.accessToken, [slots[4].id]);

    // Closure: players see "blocked" and can't hold it; it can't cover a booking.
    const blk = await call(
      'POST',
      '/v1/owner/blocks',
      { venueId: v.id, from: day, start: '17:30', end: '19:00', kind: 'maintenance', reason: 'Net repair' },
      o.accessToken,
    );
    expect(blk.status, JSON.stringify(blk.json)).toBe(200);
    const after = (await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[];
    expect(after[7].status).toBe('blocked');
    expect((await call('POST', '/v1/holds', { slotIds: [after[7].id] }, p.accessToken)).status).toBe(409);
    const clash = await call('POST', '/v1/owner/blocks', { venueId: v.id, from: day, start: '13:00', end: '14:00' }, o.accessToken);
    expect(clash.status).toBe(409);
    const blocks = (await call('GET', `/v1/owner/venues/${v.id}/blocks?from=${day}&to=${day}`, undefined, o.accessToken)).json as Json[];
    expect(blocks).toEqual([expect.objectContaining({ day, start: 1050, end: 1140, kind: 'maintenance', reason: 'Net repair' })]);
    expect((await call('DELETE', `/v1/owner/blocks/${blocks[0]!.id}`, undefined, o.accessToken)).status).toBe(200);
    expect(((await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[])[7].status).toBe('available');

    // Bookings list: search, filters.
    const all = (await call('GET', `/v1/owner/bookings?venueId=${v.id}&from=${day}&to=${day}&sort=day_asc`, undefined, o.accessToken)).json;
    expect(all.total).toBe(3);
    expect(all.items.map((b: Json) => b.source)).toEqual(['walkin', 'walkin', 'app']);
    expect(all.items[2].customer).toMatchObject({ name: 'Dash player', guest: false });
    expect((await call('GET', `/v1/owner/bookings?q=rahim`, undefined, o.accessToken)).json.total).toBe(2);
    expect((await call('GET', `/v1/owner/bookings?source=app`, undefined, o.accessToken)).json.total).toBe(1);

    // Stats for the day.
    const st = (await call('GET', `/v1/owner/stats?venueId=${v.id}&from=${day}&to=${day}`, undefined, o.accessToken)).json;
    expect(st.current).toMatchObject({
      revenue: 4800,
      appRevenue: 1800,
      walkinRevenue: 3000,
      bookings: 3,
      walkins: 2,
      hours: 4.5,
      occupancy: 30,
    });
    expect(st.series).toEqual([{ key: day, revenue: 4800, walkinRevenue: 3000, bookings: 3 }]);
    const cal = (await call('GET', `/v1/owner/calendar?month=${day.slice(0, 7)}`, undefined, o.accessToken)).json as Json[];
    expect(cal.find((c) => c.day === day)).toEqual({ day, bookings: 3, revenue: 4800 });

    // Inbox: the app booking is news; reading clears it.
    const inbox = (await call('GET', '/v1/owner/notifications', undefined, o.accessToken)).json;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: 'booking', title: 'New booking', ref: bookingId });
    await call('POST', '/v1/owner/notifications/seen', undefined, o.accessToken);
    expect((await call('GET', '/v1/owner/notifications', undefined, o.accessToken)).json.unread).toBe(0);

    // Check in a walk-in; cancel the app booking (refund flagged, player told).
    const w = walk.json.bookings[0];
    expect((await call('POST', `/v1/owner/bookings/${w.id}/check-in`, undefined, o.accessToken)).json.status).toBe('checked_in');
    const cancelled = await call('POST', `/v1/owner/bookings/${bookingId}/cancel`, { reason: 'Pitch flooded' }, o.accessToken);
    expect(cancelled.json.status).toBe('cancelled');
    const mine = (await call('GET', `/v1/bookings/${bookingId}`, undefined, p.accessToken)).json;
    expect(mine.status).toBe('cancelled');
    const notes = (await call('GET', '/v1/me/notifications', undefined, p.accessToken)).json;
    expect(JSON.stringify(notes)).toMatch(/Pitch flooded/);
    expect(((await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[])[4].status).toBe('available');

    // Another owner sees none of it.
    const x = await newUser('owner');
    expect((await call('GET', `/v1/owner/bookings/${bookingId}`, undefined, x.accessToken)).status).toBe(404);
    expect((await call('GET', `/v1/owner/stats?venueId=${v.id}&from=${day}&to=${day}`, undefined, x.accessToken)).status).toBe(404);
    expect((await call('POST', `/v1/owner/bookings/${w.id}/cancel`, {}, x.accessToken)).status).toBe(404);
    expect(
      (await call('POST', '/v1/owner/bookings', { venueId: v.id, day, starts: [600], guestName: 'Intruder', guestPhone: '01711000002', guestEmail: 'x@walkin.test' }, x.accessToken)).status,
    ).toBe(404);
    expect((await call('GET', '/v1/owner/bookings', undefined, p.accessToken)).status).toBe(401);
  });

  it('tournaments close the turf while published and list for players', async () => {
    const o = await newUser('owner');
    const v = (await call('POST', '/v1/owner/venues', base, o.accessToken)).json;
    const day = dayIn(9);
    const input = {
      venueId: v.id,
      title: 'Winter Cup',
      format: '5-a-side',
      description: 'Knockout cup',
      terms: 'Boots only. Teams must arrive 30 min early.',
      prizes: 'Trophy + ৳20,000',
      entryFee: 3000,
      maxTeams: 2,
      teamSize: 7,
      startsOn: day,
      endsOn: dayIn(10),
      startTime: '14:00',
      endTime: '20:00',
      registrationCloses: dayIn(8),
      blockTurf: true,
      status: 'draft',
    };
    const t = await call('POST', '/v1/owner/tournaments', input, o.accessToken);
    expect(t.status, JSON.stringify(t.json)).toBe(200);
    expect(((await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[]).some((s) => s.status === 'blocked')).toBe(
      false,
    );
    expect((await call('GET', `/v1/venues/${v.id}/tournaments`)).json).toEqual([]);

    const pub = await call('PUT', `/v1/owner/tournaments/${t.json.id}`, { ...input, status: 'published' }, o.accessToken);
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);
    const s9 = (await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[];
    expect(s9.filter((s) => s.status === 'blocked').map((s) => s.start)).toEqual([780, 870, 960, 1050, 1140]); // sessions touching 14:00–20:00
    const list = (await call('GET', `/v1/venues/${v.id}/tournaments`)).json;
    expect(list[0]).toMatchObject({ title: 'Winter Cup', entryFee: 300000, registrationOpen: true, start: 840, end: 1200 });

    let full = await call(
      'POST',
      `/v1/owner/tournaments/${t.json.id}/teams`,
      { name: 'Gulshan FC', captainName: 'Arif', captainPhone: '01700000001', paid: true },
      o.accessToken,
    );
    expect(full.json.teamList).toHaveLength(1);
    full = await call(
      'POST',
      `/v1/owner/tournaments/${t.json.id}/teams`,
      { name: 'Banani United', captainName: 'Sami', captainPhone: '01700000002' },
      o.accessToken,
    );
    expect(full.json).toMatchObject({ teams: 2, paidTeams: 1, collected: 3000 });
    expect(
      (
        await call(
          'POST',
          `/v1/owner/tournaments/${t.json.id}/teams`,
          { name: 'Late FC', captainName: 'Nadim', captainPhone: '01700000003' },
          o.accessToken,
        )
      ).status,
    ).toBe(409);
    expect((await call('GET', `/v1/venues/${v.id}/tournaments`)).json[0].registrationOpen).toBe(false);
    expect(
      (await call('GET', '/v1/owner/notifications', undefined, o.accessToken)).json.items.some((n: Json) => n.kind === 'tournament'),
    ).toBe(true);

    // Paid teams: can't delete, only cancel. Cancelling reopens the turf.
    expect((await call('DELETE', `/v1/owner/tournaments/${t.json.id}`, undefined, o.accessToken)).status).toBe(409);
    await call('PUT', `/v1/owner/tournaments/${t.json.id}`, { ...input, status: 'cancelled' }, o.accessToken);
    expect(((await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[]).some((s) => s.status === 'blocked')).toBe(
      false,
    );

    const x = await newUser('owner');
    expect((await call('GET', `/v1/owner/tournaments/${t.json.id}`, undefined, x.accessToken)).status).toBe(404);
    expect((await call('GET', '/v1/owner/tournaments', undefined, x.accessToken)).json).toEqual([]);
  });
  it('session sets: one live set is what players book; pause stops new bookings and shows a notice', async () => {
    const o = await newUser('owner');
    const sets = [
      { id: 'normal', name: 'Normal days', live: true, slots: [{ start: '07:00', end: '08:30', price: 1500 }, { start: '18:00', end: '19:30', price: 2500 }] },
      { id: 'ramadan', name: 'Ramadan', live: false, slots: [{ start: '20:00', end: '21:30', price: 3000 }, { start: '22:00', end: '23:30' }] },
    ];
    const v = await call('POST', '/v1/owner/venues', { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: sets }, o.accessToken);
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect(v.json.sessionSets.map((x: Json) => [x.id, x.live])).toEqual([['normal', true], ['ramadan', false]]);
    expect(v.json.sessionSets[1].slots[1]).toEqual({ start: '22:00', end: '23:30', price: null });
    expect(v.json.slots.custom.map((x: Json) => x.start)).toEqual(['07:00', '18:00']);
    const day = dayIn(2);
    let slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.map((x) => [x.start, x.price])).toEqual([[420, 150000], [1080, 250000]]);

    // Switch the live set: players get the other sessions.
    const flipped = sets.map((x) => ({ ...x, live: x.id === 'ramadan' }));
    const r = await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: flipped }, o.accessToken);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.map((x) => [x.start, x.price])).toEqual([[1200, 300000], [1320, 180000]]);

    // Day-specific sets: Ramadan on Fri+Sat, Normal on all other days; overlapping days are refused.
    const daySets = [
      { ...sets[0]!, live: true, days: [] },
      { ...sets[1]!, live: true, days: ['fri', 'sat'] },
    ];
    const ds = await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: daySets }, o.accessToken);
    expect(ds.status, JSON.stringify(ds.json)).toBe(200);
    expect(ds.json.sessionSets[1].days).toEqual(['fri', 'sat']);
    const days = Array.from({ length: 7 }, (_, i) => dayIn(i + 1));
    const fri = days.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5)!;
    const mon = days.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)!;
    const startsOn = async (d: string) => ((await call('GET', `/v1/venues/${v.json.id}/slots?day=${d}`)).json.slots as Json[]).map((x) => x.start);
    expect(await startsOn(fri)).toEqual([1200, 1320]);
    expect(await startsOn(mon)).toEqual([420, 1080]);
    const clash = await call(
      'PUT',
      `/v1/owner/venues/${v.json.id}`,
      { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: [{ ...daySets[0]!, days: ['sat', 'sun'] }, daySets[1]] },
      o.accessToken,
    );
    expect(clash.status).toBe(400);
    expect(clash.json.error.message).toMatch(/both live on Sat/);
    // Only day-specific sets live: other days are closed.
    const only = await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: [{ ...daySets[0]!, live: false }, daySets[1]] }, o.accessToken);
    expect(only.status).toBe(200);
    expect(await startsOn(mon)).toEqual([]);
    expect(await startsOn(fri)).toEqual([1200, 1320]);
    // Back to Ramadan live on all days for the checks below.
    expect((await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: flipped }, o.accessToken)).status).toBe(200);

    // Two live sets are refused; a bad set names itself.
    const two = await call('PUT', `/v1/owner/venues/${v.json.id}`, { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: sets.map((x) => ({ ...x, live: true })) }, o.accessToken);
    expect(two.status).toBe(400);
    const bad = await call(
      'PUT',
      `/v1/owner/venues/${v.json.id}`,
      { ...base, slots: { mode: 'custom', custom: [] }, sessionSets: [{ id: 'x', name: 'Winter', live: true, slots: [{ start: '07:00', end: '09:00' }, { start: '08:00', end: '10:00' }] }] },
      o.accessToken,
    );
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/Winter.*overlaps/);

    // Pause: every free session is unavailable, a hold is refused with the notice, the turf page says why.
    const p = await newUser('player');
    const paused = await call('PUT', `/v1/owner/venues/${v.json.id}/booking-pause`, { paused: true, notice: 'Closed for pitch repairs until Friday.' }, o.accessToken);
    expect(paused.status, JSON.stringify(paused.json)).toBe(200);
    expect(paused.json).toMatchObject({ bookingPaused: true, bookingNotice: 'Closed for pitch repairs until Friday.' });
    slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.every((x) => x.status === 'blocked')).toBe(true);
    const hold = await call('POST', '/v1/holds', { slotIds: [slots[0].id] }, p.accessToken);
    expect(hold.status).toBe(409);
    expect(hold.json.error.message).toBe('Closed for pitch repairs until Friday.');
    const detail = (await call('GET', `/v1/venues/${v.json.id}`)).json;
    expect(detail).toMatchObject({ bookingPaused: true, bookingNotice: 'Closed for pitch repairs until Friday.' });
    // Another owner can't touch it.
    const other = await newUser('owner');
    expect((await call('PUT', `/v1/owner/venues/${v.json.id}/booking-pause`, { paused: false }, other.accessToken)).status).toBe(404);

    // Resume: bookable again, no notice.
    const resumed = await call('PUT', `/v1/owner/venues/${v.json.id}/booking-pause`, { paused: false }, o.accessToken);
    expect(resumed.json.bookingPaused).toBe(false);
    slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.every((x) => x.status === 'available')).toBe(true);
    expect((await call('GET', `/v1/venues/${v.json.id}`)).json.bookingNotice).toBeNull();
    expect((await call('POST', '/v1/holds', { slotIds: [slots[0].id] }, p.accessToken)).status).toBe(200);
  });
  it('owner password reset by account email; player reset is separate', async () => {
    const o = await newUser('owner');
    const email = String(o.user.email);
    const R = '/v1/owner/auth/password/reset';
    // Unknown email: same answer, nothing sent, no account discovery.
    const ghost = await call('POST', `${R}/start`, { email: 'nobody-here@test.turfsides.dev' });
    expect(ghost.status).toBe(200);
    expect(ghost.json.devCode).toBeUndefined();
    // The owner's email is not a player account: the player reset knows nothing about it.
    expect((await call('POST', '/v1/auth/password/reset/start', { email })).json.devCode).toBeUndefined();
    // By email, case-insensitive.
    const s1 = await call('POST', `${R}/start`, { email: email.toUpperCase() });
    expect(s1.status, JSON.stringify(s1.json)).toBe(200);
    expect(s1.json.devCode).toMatch(/^\d{6}$/);
    expect((await call('POST', `${R}/verify`, { email, code: '000000', newPassword: 'new pass 4567' })).status).toBe(400);
    const ok = await call('POST', `${R}/verify`, { email, code: s1.json.devCode, newPassword: 'new pass 4567' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect((await call('POST', '/v1/owner/auth/login', { identifier: email, password: 'new pass 4567' })).status).toBe(200);
    // By number too.
    const s2 = await call('POST', `${R}/start`, { phone: String(o.user.phone) });
    expect(s2.json.devCode).toMatch(/^\d{6}$/);
  });

  it('owners and players are separate accounts: own sign-in, own tokens', async () => {
    const o = await newUser('owner');
    const p = await newUser('player');
    expect(o.user.roles).toEqual(['owner']);
    expect(p.user.roles).toEqual(['player']);
    // A player token can't use owner endpoints; an owner token can't use player endpoints.
    expect((await call('GET', '/v1/owner/venues', undefined, p.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, o.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/owner/me', undefined, o.accessToken)).json.id).toBe(o.user.id);
    // The owner's credentials don't sign in to the player app, and the reverse.
    expect((await call('POST', '/v1/auth/login', { identifier: String(o.user.email), password: 'owner pass 123' })).status).toBe(401);
    expect((await call('POST', '/v1/owner/auth/login', { identifier: String(p.user.email), password: 'owner pass 123' })).status).toBe(401);
    // The same person can have both: a player account with the owner's number and email.
    const both = await call('POST', '/v1/auth/signup/start', { name: 'Same Person', phone: String(o.user.phone), email: String(o.user.email), password: 'player pass 123' });
    expect(both.status, JSON.stringify(both.json)).toBe(200);
    const made = await call('POST', '/v1/auth/signup/verify', { phone: String(o.user.phone), code: both.json.devCode });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    expect(made.json.user.id).not.toBe(o.user.id);
    // Owner sessions refresh in their own table; a player refresh token is useless there.
    const login = await call('POST', '/v1/owner/auth/login', { identifier: String(o.user.email), password: 'owner pass 123' });
    expect((await call('POST', '/v1/owner/auth/refresh', { refreshToken: login.json.refreshToken })).status).toBe(200);
    expect((await call('POST', '/v1/owner/auth/refresh', { refreshToken: made.json.refreshToken })).status).toBe(401);
    // Owner account pages work.
    expect((await call('GET', '/v1/owner/me/settings', undefined, o.accessToken)).status).toBe(200);
    expect((await call('PATCH', '/v1/owner/me', { name: 'Owner Renamed' }, o.accessToken)).json.name).toBe('Owner Renamed');
  });
  it('day sheet after the sessions change: each booking once, at its real time, at the price paid; totals match the overview', async () => {
    const o = await newUser('owner');
    const day = dayIn(4);
    // Custom sessions: 04:40–06:40 for ৳2,000 and 16:00–18:00 for ৳3,400.
    const v = (
      await call(
        'POST',
        '/v1/owner/venues',
        {
          ...base,
          schedule: { opens: '00:00', closes: '23:59', sessionMinutes: 120, breakMinutes: 0 },
          pricing: { hourly: 1700 },
          slots: { mode: 'custom', custom: [{ start: '04:40', end: '06:40', price: 2000 }, { start: '16:00', end: '18:00', price: 3400 }] },
        },
        o.accessToken,
      )
    ).json;
    const p1 = await newUser('player');
    const p2 = await newUser('player');
    const slots = (await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[];
    await payFor(p1.accessToken, [slots[0].id]); // 04:40–06:40, ৳2,000
    await payFor(p2.accessToken, [slots[1].id]); // 16:00–18:00, ৳3,400

    // The owner switches to 2-hour sessions from midnight (00:00, 02:00, 04:00, 06:00 … 22:00), ৳3,400 each.
    const ch = await call(
      'PUT',
      `/v1/owner/venues/${v.id}`,
      { ...base, schedule: { opens: '00:00', closes: '00:00', sessionMinutes: 120, breakMinutes: 0 }, pricing: { hourly: 1700 }, slots: { mode: 'fixed', custom: [] } },
      o.accessToken,
    );
    expect(ch.status, JSON.stringify(ch.json)).toBe(200);

    const sheet = (await call('GET', `/v1/owner/venues/${v.id}/day?day=${day}`, undefined, o.accessToken)).json;
    const booked = (sheet.sessions as Json[]).filter((r) => r.kind === 'booking');
    // One row per booking, at the booked time, with the amount paid.
    expect(booked.map((r) => [r.start, r.end, r.price, r.status])).toEqual([
      [280, 400, 2000, 'booked'],
      [960, 1080, 3400, 'booked'],
    ]);
    // The 04:40 booking blocks today's 04:00–06:00 and 06:00–08:00 sessions; the 16:00 one matches exactly.
    expect(booked[0].covers).toEqual([{ start: 240, end: 360 }, { start: 360, end: 480 }]);
    expect(booked[1].covers).toEqual([]);
    // 04:00–06:00 and 06:00–08:00 overlap the 04:40 booking, 16:00–18:00 is the other: none listed as sessions.
    const open = (sheet.sessions as Json[]).filter((r) => r.kind === 'session').map((r) => r.start);
    expect(open).toEqual([0, 120, 480, 600, 720, 840, 1080, 1200, 1320]);
    expect(sheet.summary).toMatchObject({ total: 12, booked: 2, bookedHours: 4, revenue: 5400 });
    // Rows are in time order and never overlap.
    const all = sheet.sessions as Json[];
    for (let k = 1; k < all.length; k++) expect(all[k].start).toBeGreaterThanOrEqual(all[k - 1].end);

    // The overview and calendar say the same for that day.
    const st = (await call('GET', `/v1/owner/stats?venueId=${v.id}&from=${day}&to=${day}`, undefined, o.accessToken)).json;
    expect(st.current).toMatchObject({ bookings: 2, revenue: 5400, hours: 4 });
    expect(st.series[0]).toMatchObject({ bookings: 2, revenue: 5400 });
    const cal = (await call('GET', `/v1/owner/calendar?venueId=${v.id}&month=${day.slice(0, 7)}`, undefined, o.accessToken)).json as Json[];
    expect(cal.find((x) => x.day === day)).toMatchObject({ bookings: 2, revenue: 5400 });
    // Occupancy: 4 booked hours of 24 on sale that day.
    expect(st.current.occupancy).toBe(16.7);
  });
  it('edit a walk-in (details, amount, move); app bookings and other owners can’t', async () => {
    const o = await newUser('owner');
    const v = (await call('POST', '/v1/owner/venues', base, o.accessToken)).json;
    const day = dayIn(6);
    const w = await call('POST', '/v1/owner/bookings', { venueId: v.id, day, starts: [420], guestName: 'Rahim', guestPhone: '01711000003', guestEmail: 'rahim3@walkin.test' }, o.accessToken);
    expect(w.status, JSON.stringify(w.json)).toBe(200);
    const id = w.json.bookings[0].id as string;

    // Details and amount.
    const e1 = await call('PATCH', `/v1/owner/bookings/${id}`, { guestName: 'Rahim Uddin', guestPhone: '01711222333', note: 'Pays cash', amount: 1500 }, o.accessToken);
    expect(e1.status, JSON.stringify(e1.json)).toBe(200);
    expect(e1.json).toMatchObject({ amount: 1500, customer: { name: 'Rahim Uddin', phone: '+8801711222333' }, note: 'Pays cash', start: 420 });

    // Move to 13:00: players see 07:00 free and 13:00 taken.
    const e2 = await call('PATCH', `/v1/owner/bookings/${id}`, { day, start: 780 }, o.accessToken);
    expect(e2.status, JSON.stringify(e2.json)).toBe(200);
    expect(e2.json).toMatchObject({ day, start: 780, end: 870, amount: 1500 });
    const slots = (await call('GET', `/v1/venues/${v.id}/slots?day=${day}`)).json.slots as Json[];
    expect(slots.find((x) => x.start === 420)!.status).toBe('available');
    expect(slots.find((x) => x.start === 780)!.status).toBe('booked');
    // The day sheet and stats follow.
    const sheet = (await call('GET', `/v1/owner/venues/${v.id}/day?day=${day}`, undefined, o.accessToken)).json;
    expect(sheet.summary).toMatchObject({ booked: 1, revenue: 1500 });

    // Can't move onto someone else's booking, a closure, or a time that isn't a session.
    const p = await newUser('player');
    await payFor(p.accessToken, [slots.find((x) => x.start === 510)!.id as string]);
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { day, start: 510 }, o.accessToken)).status).toBe(409);
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { day, start: 500 }, o.accessToken)).status).toBe(400);
    expect((await call('POST', '/v1/owner/blocks', { venueId: v.id, from: day, start: '15:30', end: '17:00', kind: 'maintenance' }, o.accessToken)).status).toBe(200);
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { day, start: 870 }, o.accessToken)).status).toBe(409);
    // Half a move is refused.
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { start: 600 }, o.accessToken)).status).toBe(400);

    // App bookings can't be edited; another owner can't touch it.
    const appBooking = (await call('GET', `/v1/owner/bookings?venueId=${v.id}&source=app`, undefined, o.accessToken)).json.items[0];
    expect((await call('PATCH', `/v1/owner/bookings/${appBooking.id}`, { guestName: 'Nope' }, o.accessToken)).status).toBe(403);
    const other = await newUser('owner');
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { guestName: 'Nope' }, other.accessToken)).status).toBe(404);

    // Cancelled walk-ins can't be edited.
    await call('POST', `/v1/owner/bookings/${id}/cancel`, { reason: 'No show' }, o.accessToken);
    expect((await call('PATCH', `/v1/owner/bookings/${id}`, { guestName: 'Late' }, o.accessToken)).status).toBe(409);
  });
});
