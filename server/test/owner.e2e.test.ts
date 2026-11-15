/** Owner turf management, using the exact demo JSON from docs/postman/demo-turfs.json. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;
type Json = Record<string, any>;
// The demo photos live on images.turfsides.com; point them at this server's R2 domain (a stand-in in CI).
const R2 = (process.env.R2_PUBLIC_URL ?? 'https://images.turfsides.com').replace(/\/+$/, '');
const demo: Json[] = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'postman', 'demo-turfs.json'), 'utf8').replaceAll('https://images.turfsides.com', R2));

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
async function newUser(role: 'player' | 'owner') {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const A = role === 'owner' ? '/v1/owner/auth' : '/v1/auth';
  const s = await call('POST', `${A}/signup/start`, { name: `Test ${role}`, phone, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'owner pass 123', role });
  return (await call('POST', `${A}/signup/verify`, { phone, code: s.json.devCode })).json as { accessToken: string; user: Json };
}
const tomorrow = () => new Date(Date.now() + 6 * 3600_000 + 86400_000).toISOString().slice(0, 10);

d('owner turfs', () => {
  it('creates the 5 demo turfs and players can find and book them', async () => {
    const o = await newUser('owner');
    expect(o.user.roles).toContain('owner');
    const made: Json[] = [];
    for (const t of demo) {
      const r = await call('POST', '/v1/owner/venues', t, o.accessToken);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ name: t.name, status: 'published', schedule: { opens: t.schedule.opens, closes: t.schedule.closes }, pricing: { hourly: t.pricing.hourly } });
      made.push(r.json);
    }
    expect((await call('GET', '/v1/owner/venues', undefined, o.accessToken)).json).toHaveLength(5);

    // Players see it (prices in poisha), with slots running past midnight.
    const banani = made[0];
    const v = (await call('GET', `/v1/venues/${banani.id}`)).json;
    expect(v.photos).toEqual(demo[0].photos);
    const slots = (await call('GET', `/v1/venues/${banani.id}/slots?day=${tomorrow()}`)).json.slots;
    expect(slots).toHaveLength(20); // 06:00 → 02:00, 60 min
    expect(slots.at(-1).end).toBe(26 * 60);
    const uttara = (await call('GET', `/v1/venues/${made[4].id}/slots?day=${tomorrow()}`)).json.slots;
    expect(uttara[1].start - uttara[0].start).toBe(75); // 60 min + 15 min break
    const near = await call('GET', `/v1/venues/explore?lat=23.7937&lng=90.4045&q=banani`);
    expect([...near.json.near, ...near.json.further].map((x: Json) => x.id)).toContain(banani.id);

    // Edit, then hide.
    const edited = await call('PUT', `/v1/owner/venues/${banani.id}`, { ...demo[0], pricing: { hourly: 2200 } }, o.accessToken);
    expect(edited.json.pricing).toEqual({ hourly: 2200, byWeekday: {}, specialDates: {} });
    expect((await call('DELETE', `/v1/owner/venues/${made[3].id}`, undefined, o.accessToken)).status).toBe(200);
    expect((await call('GET', `/v1/venues/${made[3].id}`)).status).toBe(404);
  });

  it('keeps owners in their own lane', async () => {
    const player = await newUser('player');
    expect((await call('POST', '/v1/owner/venues', demo[0], player.accessToken)).status).toBe(401);
    const a = await newUser('owner');
    const b = await newUser('owner');
    const t = (await call('POST', '/v1/owner/venues', demo[1], a.accessToken)).json;
    expect((await call('PUT', `/v1/owner/venues/${t.id}`, demo[1], b.accessToken)).status).toBe(404);
    expect((await call('DELETE', `/v1/owner/venues/${t.id}`, undefined, b.accessToken)).status).toBe(404);
    const bad = await call('POST', '/v1/owner/venues', { ...demo[0], schedule: { ...demo[0].schedule, opens: '6am' } }, a.accessToken);
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/^schedule\.opens: /);
    const foreignPhoto = await call('POST', '/v1/owner/venues', { ...demo[0], photos: ['https://evil.example/x.jpg'] }, a.accessToken);
    expect(foreignPhoto.status).toBe(400);
  });
});
