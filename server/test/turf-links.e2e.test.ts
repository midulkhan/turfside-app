/** Turf share links (turfsides.com/FDJV346) and reference numbers (TS-5356). */
import { beforeAll, describe, expect, it } from 'vitest';

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
async function owner() {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const email = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`;
  const s = await call('POST', '/v1/owner/auth/signup/start', { name: 'Link Owner', phone, email, password: 'owner pass 123' });
  return (await call('POST', '/v1/owner/auth/signup/verify', { phone, code: s.json.devCode })).json.accessToken as string;
}
const venue = (name: string, status = 'published') => ({
  name,
  area: 'Gulshan',
  city: 'Dhaka',
  address: 'Road 1, Gulshan',
  lat: 23.79,
  lng: 90.41,
  formats: ['5-a-side'],
  schedule: { opens: '07:00', closes: '23:00', sessionMinutes: 60, breakMinutes: 0 },
  pricing: { hourly: 1800 },
  status,
});

d('turf links and reference numbers', () => {
  // One owner and four turfs for the whole file: creating turfs is rate-limited per address.
  let t = '';
  let made: { status: number; json: Json }[] = [];
  let draft: Json = {};
  beforeAll(async () => {
    t = await owner();
    for (const name of ['Link Arena 1', 'Code Lookup Arena', 'Preview <Arena> & Co']) made.push(await call('POST', '/v1/owner/venues', venue(name), t));
    draft = (await call('POST', '/v1/owner/venues', venue('Draft Arena', 'draft'), t)).json;
  });

  it('every new turf gets a unique TS-#### and a 7-character share link', async () => {
    for (const m of made) {
      expect(m.status, JSON.stringify(m.json)).toBe(200);
      expect(m.json.ref).toMatch(/^TS-\d{4}$/);
      expect(m.json.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
      expect(m.json.shareUrl).toBe(`https://turfsides.com/${m.json.shortCode}`);
    }
    expect(new Set([...made.map((m) => m.json.ref), draft.ref]).size).toBe(4);
    expect(new Set([...made.map((m) => m.json.shortCode), draft.shortCode]).size).toBe(4);

    // They never change when the turf is edited.
    const v = made[0]!.json;
    const upd = await call('PUT', `/v1/owner/venues/${v.id}`, venue('Link Arena Renamed'), t);
    expect(upd.status, JSON.stringify(upd.json)).toBe(200);
    expect([upd.json.ref, upd.json.shortCode]).toEqual([v.ref, v.shortCode]);

    // Players see them on the turf page.
    const pub = (await call('GET', `/v1/venues/${v.id}`)).json;
    expect([pub.ref, pub.shortCode, pub.shareUrl]).toEqual([v.ref, v.shortCode, v.shareUrl]);
  });

  it('the app resolves a code to its turf; unknown, malformed and draft codes are not found', async () => {
    const v = made[1]!.json;
    const r = await call('GET', `/v1/venues/code/${v.shortCode}`);
    expect(r.json).toMatchObject({ id: v.id, name: 'Code Lookup Arena', ref: v.ref, shortCode: v.shortCode });
    expect((await call('GET', `/v1/venues/code/${v.shortCode.toLowerCase()}`)).json.id).toBe(v.id); // typed in lower case
    expect((await call('GET', '/v1/venues/code/ZZZZZZZ')).status).toBe(404);
    expect((await call('GET', '/v1/venues/code/abc')).status).toBe(404);
    expect((await call('GET', '/v1/venues/code/OOOO000')).status).toBe(404); // look-alikes are never issued

    expect(draft.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/); // the owner can see it before publishing
    expect((await call('GET', `/v1/venues/code/${draft.shortCode}`)).status).toBe(404);
  });

  it('the share page shows the turf with a preview for WhatsApp and an open-in-app button', async () => {
    const v = made[2]!.json;
    const res = await fetch(`${API}/t/${v.shortCode}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Preview &lt;Arena&gt; &amp; Co'); // escaped
    expect(html).not.toContain('Preview <Arena>');
    expect(html).toContain(`<meta property="og:url" content="https://turfsides.com/${v.shortCode}">`);
    expect(html).toContain('og:image');
    expect(html).toContain(`turfsides://t/${v.shortCode}`);
    expect(html).toContain(v.ref);
    expect(html).toContain('From ৳1,800/hr');
    const missing = await fetch(`${API}/t/ZZZZZZZ`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('isn’t active');
  });

  it('seeded turfs got codes from the migration', async () => {
    const list = (await call('GET', '/v1/venues/explore?lat=23.78&lng=90.41')).json;
    const id = (list.near?.[0] ?? list.further?.[0])?.id as string;
    const pub = (await call('GET', `/v1/venues/${id}`)).json;
    expect(pub.ref).toMatch(/^TS-\d{4}$/);
    expect(pub.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
  });
});
