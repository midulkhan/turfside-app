/**
 * Find an opponent, end to end: a host posts their booking as "looking for an opponent team" →
 * captains challenge with their team → the host accepts one → that captain pays the team's
 * share (simulated bKash) → the game is set and the post leaves the opponents feed.
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

d('find an opponent', () => {
  let host: Awaited<ReturnType<typeof newUser>>;
  let capA: Awaited<ReturnType<typeof newUser>>;
  let capB: Awaited<ReturnType<typeof newUser>>;
  let bookingId = '';
  let matchId = '';
  let total = 0;
  beforeAll(async () => {
    [host, capA, capB] = await Promise.all([newUser('Host Hasan'), newUser('Captain Arif'), newUser('Captain Badal')]);
    bookingId = await paidBooking(host.accessToken, 'v_kickoff_uttara', 8);
    total = (await call('GET', `/v1/bookings/${bookingId}`, undefined, host.accessToken)).json.amountPaid;
  });

  it('host posts for an opponent: one team slot, the team pays the chosen share', async () => {
    // A team name is required; the split must be one of the offered ones.
    expect((await call('POST', '/v1/matches', { bookingId, level: 'regular', type: 'opponent', sharePhone: true }, host.accessToken)).status).toBe(400);
    expect((await call('POST', '/v1/matches', { bookingId, level: 'regular', type: 'opponent', teamName: 'Badda FC', opponentPercent: 45, sharePhone: true }, host.accessToken)).status).toBe(400);
    const r = await call('POST', '/v1/matches', { bookingId, level: 'regular', type: 'opponent', teamName: 'Badda FC', opponentPercent: 40, sharePhone: true }, host.accessToken);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    matchId = r.json.id;
    expect(r.json).toMatchObject({ type: 'opponent', teamName: 'Badda FC', opponentPercent: 40, opponent: null, spotsLeft: 1, title: 'Badda FC vs ?' });
    expect(r.json.share).toBe(Math.ceil((total * 0.4) / 100) * 100);

    // It shows in the opponents feed, not in the players feed (which older apps use).
    const opp = (await call('GET', '/v1/matches?type=opponent&limit=20', undefined, capA.accessToken)).json.items.map((m: Json) => m.id);
    expect(opp).toContain(matchId);
    const players = (await call('GET', '/v1/matches?limit=20', undefined, capA.accessToken)).json.items.map((m: Json) => m.id);
    expect(players).not.toContain(matchId);
  });

  it('each request gets a turfsides.com share link with a page and a preview card', async () => {
    const m = (await call('GET', `/v1/matches/${matchId}`, undefined, capA.accessToken)).json;
    expect(m.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    expect(m.shareUrl).toMatch(new RegExp(`/${m.shortCode}$`));
    // The app resolves the code (any case) to the request; turf codes still resolve to turfs.
    expect((await call('GET', `/v1/links/${m.shortCode.toLowerCase()}`)).json).toEqual({ kind: 'match', id: matchId });
    const turf = (await call('GET', '/v1/venues/v_kickoff_uttara')).json;
    expect((await call('GET', `/v1/links/${turf.shortCode}`)).json).toEqual({ kind: 'turf', id: 'v_kickoff_uttara' });
    expect((await call('GET', '/v1/links/ZZZZZZZ')).status).toBe(404);
    // The page people without the app see, with Open Graph tags for WhatsApp and others.
    const page = await fetch(`${API}/t/${m.shortCode}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Badda FC vs ?');
    expect(html).toContain('Opponent wanted');
    expect(html).toContain(`turfsides://t/${m.shortCode}`);
    expect(html).not.toContain('Host Hasan'); // no personal details on the public page
    const img = /<meta property="og:image" content="([^"]+)"/.exec(html)![1].replace(/^https?:\/\/[^/]+/, API!);
    const card = await fetch(img);
    expect(card.headers.get('content-type')).toBe('image/jpeg');
    expect((await card.arrayBuffer()).byteLength).toBeGreaterThan(20_000);
  });

  it('captains challenge with their team; the host accepts one; that captain pays; the game is set', async () => {
    // A challenge needs the team's name and a size that fits one side.
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true, teamSize: 5 }, capA.accessToken)).status).toBe(400);
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true, teamName: 'Uttara Kings', teamSize: 40 }, capA.accessToken)).status).toBe(400);
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true, teamName: 'Uttara Kings', teamSize: 5, level: 'regular' }, capA.accessToken)).status).toBe(200);
    expect((await call('POST', `/v1/matches/${matchId}/join`, { sharePhone: true, teamName: 'Mirpur United', teamSize: 4 }, capB.accessToken)).status).toBe(200);

    const man = (await call('GET', `/v1/matches/${matchId}/manage`, undefined, host.accessToken)).json;
    expect(man.requests.map((x: Json) => x.teamName).sort()).toEqual(['Mirpur United', 'Uttara Kings']);
    expect(man.requests.find((x: Json) => x.teamName === 'Uttara Kings').teamSize).toBe(5);
    const notes = (await call('GET', '/v1/me/notifications', undefined, host.accessToken)).json;
    expect(notes[0].title).toBe('New challenge');

    // Accept one team: the other can't be accepted while it pays.
    expect((await call('POST', `/v1/matches/${matchId}/requests/${capA.user.id}/accept`, undefined, host.accessToken)).status).toBe(200);
    expect((await call('POST', `/v1/matches/${matchId}/requests/${capB.user.id}/accept`, undefined, host.accessToken)).status).toBe(409);
    expect((await call('GET', '/v1/me/notifications', undefined, capA.accessToken)).json[0].title).toBe('Challenge accepted! Pay to confirm');

    const pay = await call('POST', `/v1/matches/${matchId}/pay`, {}, capA.accessToken, { 'Idempotency-Key': randomUUID() });
    expect(pay.status, JSON.stringify(pay.json)).toBe(200);
    await fetch(`${API}/v1/payments/simulate/${pay.json.paymentId}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=pay' });
    expect((await call('GET', `/v1/payments/${pay.json.paymentId}`, undefined, capA.accessToken)).json.status).toBe('confirmed');

    // Game set: the captain sees the host's pass and the opponent; the post leaves the feed.
    const seen = (await call('GET', `/v1/matches/${matchId}`, undefined, capA.accessToken)).json;
    expect(seen.my).toBe('paid');
    expect(seen.opponent).toEqual({ teamName: 'Uttara Kings', size: 5 });
    expect(seen.pass?.passToken).toBeTruthy();
    expect(seen.playersIn).toBe(seen.playersTotal);
    expect((await call('GET', '/v1/me/notifications', undefined, host.accessToken)).json[0].title).toBe('Opponent confirmed');
    const feed = (await call('GET', '/v1/matches?type=opponent&limit=20', undefined, capB.accessToken)).json.items.map((m: Json) => m.id);
    expect(feed).not.toContain(matchId);
  });
});
