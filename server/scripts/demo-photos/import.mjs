// One-off: fetch free-licence demo photos (Pexels licence: free for commercial use, no attribution
// required), crop to 16:10, compress like the app does (WebP, ≤1600 px, quality stepped to ~400 KB),
// upload them to R2 through the live API as a demo owner, and write the resulting URLs.
// Run in CI: node import.mjs https://api.turfsides.com
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import sharp from 'sharp';

const API = process.argv[2] ?? 'https://api.turfsides.com';
const photos = JSON.parse(readFileSync(new URL('./photos.json', import.meta.url), 'utf8'));
const out = new URL('./out/', import.meta.url);
mkdirSync(out, { recursive: true });

const j = async (method, path, body, token) => {
  const r = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
};

const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const start = await j('POST', '/v1/auth/signup/start', { name: 'TurfSides Demo Photos', phone, password: `demo-${Date.now()}-photos`, role: 'owner' });
const { accessToken } = await j('POST', '/v1/auth/signup/verify', { phone, code: start.devCode });

const results = [];
const thumbs = [];
for (const p of photos) {
  const src = `https://images.pexels.com/photos/${p.id}/pexels-photo-${p.id}.jpeg?auto=compress&cs=tinysrgb&w=2400`;
  const res = await fetch(src);
  if (!res.ok) { console.log(`SKIP ${p.id}: HTTP ${res.status}`); continue; }
  const input = Buffer.from(await res.arrayBuffer());
  const base = sharp(input).rotate().resize(1600, 1000, { fit: 'cover', position: sharp.strategy.attention });
  let webp;
  for (const quality of [82, 74, 66, 58]) {
    webp = await base.clone().webp({ quality, effort: 5 }).toBuffer();
    if (webp.length <= 400 * 1024) break;
  }
  const t = await j('POST', '/v1/uploads', { purpose: 'venue', contentType: 'image/webp', size: webp.length }, accessToken);
  const put = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: webp });
  if (!put.ok) throw new Error(`upload ${p.id} → ${put.status}`);
  const url = `https://images.turfsides.com/${t.key}`;
  const check = await fetch(url);
  console.log(`OK   ${p.slot.padEnd(16)} ${String(Math.round(webp.length / 1024)).padStart(4)} KB  public ${check.status}  ${url}`);
  results.push({ ...p, url, bytes: webp.length, source: `https://www.pexels.com/photo/${p.id}/` });
  thumbs.push(await sharp(webp).resize(400, 250).jpeg({ quality: 70 }).toBuffer());
}
writeFileSync(new URL('./urls.json', out), JSON.stringify(results, null, 2));

// Contact sheet (4 columns) so the picks can be reviewed at a glance.
const cols = 4, w = 400, h = 250, rows = Math.ceil(thumbs.length / cols);
const sheet = await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#ffffff' } })
  .composite(thumbs.map((input, i) => ({ input, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
  .jpeg({ quality: 75 })
  .toBuffer();
writeFileSync(new URL('./contact-sheet.jpg', out), sheet);
console.log(`done: ${results.length} photos`);
