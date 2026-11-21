/**
 * Walk-in tickets: phone and email required; the booking joins a matching player's account; the
 * customer is emailed the ticket PDF; the ticket link (23-character token) and its PDF; the QR on
 * the owner's dashboard; resend; cancellations.
 */
import { describe, expect, it } from 'vitest';

import { newTicketToken, TICKET_TOKEN } from '../src/services/tickets';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const rand = () => Math.random().toString(36).slice(2, 10);
const newPhone = () => `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
async function newUser(role: 'player' | 'owner') {
  const phone = newPhone();
  const email = `w${rand()}@test.turfsides.dev`;
  const A = role === 'owner' ? '/v1/owner/auth' : '/v1/auth';
  const s = await call('POST', `${A}/signup/start`, { name: `Walk ${role}`, phone, email, password: 'owner pass 123', role });
  const v = (await call('POST', `${A}/signup/verify`, { phone, code: s.json.devCode })).json;
  return { accessToken: v.accessToken as string, phone, email };
}
const dayIn = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const emails = async () => (await call('GET', '/v1/test/emails')).json.sent as Json[];
async function until<T>(f: () => Promise<T | undefined>) {
  for (let i = 0; i < 60; i++) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
}

describe('ticket tokens', () => {
  it('are 23 letters and digits, all different', () => {
    const all = new Set(Array.from({ length: 2000 }, () => newTicketToken()));
    expect(all.size).toBe(2000);
    for (const t of all) expect(t).toMatch(TICKET_TOKEN);
    // Every character of the alphabet turns up (no bias toward a subset).
    expect(new Set([...all].join('')).size).toBe(62);
  });
});

d('walk-in tickets', () => {
  it('requires phone and email, links accounts, emails the PDF, and serves the ticket link', async () => {
    const o = await newUser('owner');
    const v = (
      await call(
        'POST',
        '/v1/owner/venues',
        {
          name: `Ticket Arena ${rand()}`,
          area: 'Banani',
          city: 'Dhaka',
          address: 'Road 11, Banani',
          lat: 23.79,
          lng: 90.4,
          formats: ['5-a-side'],
          schedule: { opens: '07:00', closes: '23:00', sessionMinutes: 60, breakMinutes: 0 },
          pricing: { hourly: 1500 },
        },
        o.accessToken,
      )
    ).json;
    expect(v.id).toBeTruthy();
    const day = dayIn(3);
    const walk = (body: Json) => call('POST', '/v1/owner/bookings', { venueId: v.id, day, guestName: 'Rahim Uddin', ...body }, o.accessToken);

    // Phone and email are required, and must be real-looking.
    expect((await walk({ starts: [420], guestEmail: 'a@b.co' })).status).toBe(400);
    expect((await walk({ starts: [420], guestPhone: '01711000000' })).status).toBe(400);
    expect((await walk({ starts: [420], guestPhone: '12345', guestEmail: 'a@b.co' })).status).toBe(400);
    expect((await walk({ starts: [420], guestPhone: '01711000000', guestEmail: 'not-an-email' })).status).toBe(400);

    // 1) A guest with no account: still a guest, still emailed.
    const before = (await emails()).length;
    const g = await walk({ starts: [420], guestPhone: '+880 1811-000111', guestEmail: 'Guest.One@Example.com' });
    expect(g.status, JSON.stringify(g.json)).toBe(200);
    const gb = g.json.bookings[0];
    expect(gb.customer).toMatchObject({ name: 'Rahim Uddin', phone: '+8801811000111', email: 'guest.one@example.com', guest: true });
    const mail = await until(async () => (await emails()).slice(before).find((m) => m.kind === 'walkin' && m.to === 'guest.one@example.com'));
    expect(mail.subject).toContain('Booking confirmed');
    expect(mail.html).toContain('booked this for you');
    expect(mail.html).toContain('/static/brand/email-wordmark.png');
    const url = mail.html.match(/https?:\/\/[^"]+\/ticket\/([A-Za-z0-9]{23})/)![0] as string;
    const token = url.slice(-23);
    expect(mail.attachments[0].url).toBe(`${url}/${mail.attachments[0].filename}`);

    // The ticket link: the page, then the PDF (built on request).
    const pageRes = await fetch(url);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get('cache-control')).toBe('no-store');
    expect(pageRes.headers.get('referrer-policy')).toBe('no-referrer');
    const page = await pageRes.text();
    expect(page).toContain(gb.code);
    expect(page).toContain('<svg');
    expect(page).toContain('Rahim Uddin');
    const pdf = await fetch(mail.attachments[0].url);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10_000);

    // Wrong or malformed tokens: nothing.
    expect((await fetch(`${API}/ticket/${newTicketToken()}`)).status).toBe(404);
    expect((await fetch(`${API}/ticket/short`)).status).toBe(404);
    expect((await fetch(`${API}/ticket/${newTicketToken()}/x.pdf`)).status).toBe(404);

    // The owner sees the same QR and link; the pass scans as this walk-in.
    const t = await call('GET', `/v1/owner/bookings/${gb.id}/ticket`, undefined, o.accessToken);
    expect(t.status).toBe(200);
    expect(t.json).toMatchObject({ code: gb.code, url, email: 'guest.one@example.com', status: 'confirmed' });
    expect(t.json.qrSvg).toContain('<svg');
    const scan = await call('POST', '/v1/passes/verify', { token: t.json.pass }, o.accessToken);
    expect(scan.status, JSON.stringify(scan.json)).toBe(200);
    expect(scan.json.booking.holder.name).toBe('Rahim Uddin');
    expect(scan.json.ticket.via).toBe('At the turf');
    // Another owner can't see it.
    const x = await newUser('owner');
    expect((await call('GET', `/v1/owner/bookings/${gb.id}/ticket`, undefined, x.accessToken)).status).toBe(404);

    // Resend.
    const n = (await emails()).length;
    expect((await call('POST', `/v1/owner/bookings/${gb.id}/ticket/send`, {}, o.accessToken)).json).toMatchObject({ sent: true });
    expect((await emails()).slice(n).filter((m) => m.kind === 'walkin')).toHaveLength(1);

    // 2) A player's phone number: the booking lands in their app; they can't cancel it there.
    const p = await newUser('player');
    const m1 = await walk({ starts: [480], guestPhone: `0${p.phone}`, guestEmail: `other.${rand()}@example.com` });
    expect(m1.status, JSON.stringify(m1.json)).toBe(200);
    expect(m1.json.bookings[0].customer).toMatchObject({ name: 'Rahim Uddin', guest: false });
    const mine = (await call('GET', '/v1/me/bookings', undefined, p.accessToken)).json as Json[];
    const got = mine.find((b) => b.id === m1.json.bookings[0].id);
    expect(got).toMatchObject({ code: m1.json.bookings[0].code, method: 'the turf', status: 'confirmed' });
    expect(got!.passToken).toMatch(/^TSP2\./);
    expect((await call('POST', `/v1/bookings/${got!.id}/cancel`, {}, p.accessToken)).status).toBe(403);

    // 3) A player's email (any phone): theirs too.
    const q2 = await newUser('player');
    const m2 = await walk({ starts: [540], guestPhone: '01999000222', guestEmail: q2.email.toUpperCase() });
    expect(m2.json.bookings[0].customer.guest).toBe(false);
    expect(((await call('GET', '/v1/me/bookings', undefined, q2.accessToken)).json as Json[]).some((b) => b.id === m2.json.bookings[0].id)).toBe(true);

    // Editing the guest's phone to a player's: the booking moves to that account.
    const e = await call('PATCH', `/v1/owner/bookings/${gb.id}`, { guestPhone: p.phone }, o.accessToken);
    expect(e.status, JSON.stringify(e.json)).toBe(200);
    expect(e.json.customer.guest).toBe(false);
    expect(((await call('GET', '/v1/me/bookings', undefined, p.accessToken)).json as Json[]).some((b) => b.id === gb.id)).toBe(true);

    // Cancelled: the link says so, and the PDF is gone.
    expect((await call('POST', `/v1/owner/bookings/${gb.id}/cancel`, { reason: 'Rain' }, o.accessToken)).status).toBe(200);
    expect(await (await fetch(url)).text()).toContain('This booking was cancelled');
    expect((await fetch(mail.attachments[0].url)).status).toBe(404);
    expect((await call('POST', `/v1/owner/bookings/${gb.id}/ticket/send`, {}, o.accessToken)).status).toBe(409);
    void token;
  });
});
