/**
 * Booking confirmation emails: when a player pays in the app, the player gets "your booking has
 * been confirmed" (with a working entry-pass QR image) and the turf owner gets "you got a new
 * booking". Exactly once per payment; walk-ins don't send.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
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
async function newUser(role: 'player' | 'owner', name: string) {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const email = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`;
  const A = role === 'owner' ? '/v1/owner/auth' : '/v1/auth';
  const s = await call('POST', `${A}/signup/start`, { name, phone, email, password: 'owner pass 123' });
  const v = (await call('POST', `${A}/signup/verify`, { phone, code: s.json.devCode })).json as { accessToken: string };
  return { ...v, phone, email };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const emails = async () => (await call('GET', '/v1/test/emails')).json.sent as Json[];
const until = async <T,>(f: () => Promise<T | undefined>) => {
  for (let i = 0; i < 40; i++) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
};

d('booking confirmation emails', () => {
  it('player and owner each get one email when an app booking is paid', async () => {
    const o = await newUser('owner', 'Karim Owner');
    const v = await call(
      'POST',
      '/v1/owner/venues',
      {
        name: 'Email Test Arena',
        area: 'Banani',
        city: 'Dhaka',
        address: 'Road 11, Banani',
        lat: 23.79,
        lng: 90.4,
        formats: ['5-a-side'],
        schedule: { opens: '07:00', closes: '23:00', sessionMinutes: 90, breakMinutes: 0 },
        pricing: { hourly: 2000 },
      },
      o.accessToken,
    );
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    const day = dayIn(2);
    const slots = (await call('GET', `/v1/venues/${v.json.id}/slots?day=${day}`)).json.slots as Json[];

    const p = await newUser('player', 'Rafi Ahmed');
    // Two back-to-back sessions read as one ticket: 7:00 – 10:00 AM.
    const hold = await call('POST', '/v1/holds', { slotIds: [slots[0].id, slots[1].id] }, p.accessToken);
    expect(hold.status, JSON.stringify(hold.json)).toBe(200);
    const pay = await call('POST', '/v1/payments', { holdId: hold.json.holdId, note: 'Bring bibs please' }, p.accessToken, { 'Idempotency-Key': randomUUID() });
    await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=pay',
    });
    expect((await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, p.accessToken)).json.status).toBe('confirmed');
    // Polling again (and the app's own status checks) must not send again.
    await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, p.accessToken);

    const mine = await until(async () => {
      const all = (await emails()).filter((m) => m.paymentId === pay.json.paymentId);
      return all.length >= 2 ? all : undefined;
    });
    expect(mine).toBeDefined();
    await new Promise((r) => setTimeout(r, 300));
    const all = (await emails()).filter((m) => m.paymentId === pay.json.paymentId);
    expect(all).toHaveLength(2);

    const player = all.find((m) => m.kind === 'player')!;
    expect(player.to).toBe(p.email);
    expect(player.subject).toMatch(/^Booking confirmed: Email Test Arena, /);
    expect(player.html).toContain('Congratulations, Rafi!');
    expect(player.html).toContain('Your booking has been confirmed');
    expect(player.html).toContain('7:00 AM – 10:00 AM');
    expect(player.html).toContain('3 hours');
    expect(player.html).toContain('৳6,000'); // 3 h × ৳2,000
    expect(player.html).toContain('Bring bibs please');
    expect(player.html).toContain('Thank you for using TurfSides');
    expect(player.text).toContain('7:00 AM – 10:00 AM');

    const owner = all.find((m) => m.kind === 'owner')!;
    expect(owner.to).toBe(o.email);
    expect(owner.html).toContain('Congrats, you got a new booking');
    expect(owner.html).toContain('Rafi Ahmed');
    expect(owner.html).toContain(`+880 ${p.phone.slice(0, 4)}-${p.phone.slice(4)}`);
    expect(owner.html).toContain('৳6,000');
    expect(owner.html).not.toContain('/qr.png'); // the pass is the player's, not the owner's

    // No QR in the email: the entry pass lives in the app.
    expect(player.html).not.toContain('/qr.png');

    // The emails have the dark logo header, not the old banner; the player's links to the ticket.
    expect(player.html).toContain('/static/brand/email-wordmark.png');
    expect(player.html).not.toContain('email-booking-player.png');
    expect(owner.html).not.toContain('email-booking-owner.png');
    expect(player.html).toMatch(/\/ticket\/[A-Za-z0-9]{23}/);

    // A walk-in the owner adds: only the customer is emailed (the owner made it), with the ticket PDF.
    const before = (await emails()).length;
    const w = await call(
      'POST',
      '/v1/owner/bookings',
      { venueId: v.json.id, day, starts: [slots[4].start], guestName: 'Walk In', guestPhone: '01799000111', guestEmail: 'walkin.guest@test.turfsides.dev', amount: 3000 },
      o.accessToken,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(w.status, JSON.stringify(w.json)).toBe(200);
    const walk = (await until(async () => (await emails()).slice(before).find((m) => m.kind === 'walkin')))!;
    expect(walk.to).toBe('walkin.guest@test.turfsides.dev');
    expect(walk.attachments).toHaveLength(1);
    expect(walk.attachments[0].filename).toMatch(/^TurfSides-ticket-TS-\d{6}-\d{4}\.pdf$/);
    expect((await emails()).slice(before).filter((m) => m.kind === 'owner')).toHaveLength(0);
  });
});
