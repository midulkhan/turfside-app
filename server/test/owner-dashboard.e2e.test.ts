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
  const s = await call('POST', '/v1/auth/signup/start', {
    name: `Dash ${role}`,
    phone,
    email: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`,
    password: 'owner pass 123',
    role,
  });
  return (await call('POST', '/v1/auth/signup/verify', { phone, code: s.json.devCode })).json as { accessToken: string; user: Json };
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
      { venueId: v.id, day, starts: [420, 510], guestName: 'Rahim', guestPhone: '01711000000', amount: 3000 },
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
      (await call('POST', '/v1/owner/bookings', { venueId: v.id, day, starts: [420], guestName: 'Karim' }, o.accessToken)).status,
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
      (await call('POST', '/v1/owner/bookings', { venueId: v.id, day, starts: [600], guestName: 'Intruder' }, x.accessToken)).status,
    ).toBe(404);
    expect((await call('GET', '/v1/owner/bookings', undefined, p.accessToken)).status).toBe(403);
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
});
