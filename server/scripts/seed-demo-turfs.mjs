// Create the demo turfs (docs/postman/demo-turfs.json) on a live API as one owner account.
// Skips turfs that already exist (by name). Development mode only: uses the test SMS code.
//   node scripts/seed-demo-turfs.mjs https://api.turfsides.com <phone> <password>
import { readFileSync } from 'node:fs';

const [API = 'https://api.turfsides.com', phone, password] = process.argv.slice(2);
const turfs = JSON.parse(readFileSync(new URL('../../docs/postman/demo-turfs.json', import.meta.url), 'utf8'));
const j = async (method, path, body, token) => {
  const r = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// Sign in, or create the owner account if it doesn't exist yet.
let auth = await j('POST', '/v1/auth/login', { identifier: phone, password });
if (auth.status !== 200) {
  const s = await j('POST', '/v1/auth/signup/start', { name: 'TurfSides Demo Owner', phone, password, role: 'owner' });
  if (!s.json.devCode) throw new Error(`sign-up failed: ${JSON.stringify(s.json)}`);
  auth = await j('POST', '/v1/auth/signup/verify', { phone, code: s.json.devCode });
  if (auth.status !== 200) throw new Error(`verify failed: ${JSON.stringify(auth.json)}`);
  console.log('Created owner account', phone);
} else console.log('Signed in as existing owner', phone);
const token = auth.json.accessToken;
if (!auth.json.user.roles.includes('owner')) throw new Error('That account is not an owner');

for (const t of turfs) {
  const found = await j('GET', `/v1/venues/explore?lat=${t.lat}&lng=${t.lng}&q=${encodeURIComponent(t.name)}`);
  const hit = [...(found.json.near ?? []), ...(found.json.further ?? [])].find((v) => v.name === t.name);
  if (hit) { console.log(`EXISTS  ${t.name} (${hit.id})`); continue; }
  const r = await j('POST', '/v1/owner/venues', t, token);
  if (r.status !== 200) throw new Error(`${t.name}: ${r.status} ${JSON.stringify(r.json)}`);
  console.log(`CREATED ${t.name} (${r.json.id}) — ${r.json.photos.length} photos, ${r.json.schedule.opens}–${r.json.schedule.closes}, ৳${r.json.pricing.hourly}/h`);
}

// What players now see.
for (const t of turfs) {
  const found = await j('GET', `/v1/venues/explore?lat=${t.lat}&lng=${t.lng}&q=${encodeURIComponent(t.name)}`);
  const v = [...(found.json.near ?? []), ...(found.json.further ?? [])].find((x) => x.name === t.name);
  const photo = v?.photo ? (await fetch(v.photo)).status : 'none';
  console.log(`VISIBLE ${t.name}: ${v ? `yes, ৳${v.hourlyFrom / 100}/h, photo HTTP ${photo}` : 'NO'}`);
}
