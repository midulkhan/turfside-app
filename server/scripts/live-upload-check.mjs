// End-to-end photo upload check against a live API (development mode only: uses the test SMS code).
// node scripts/live-upload-check.mjs https://api.turfsides.com
const API = process.argv[2] ?? 'https://api.turfsides.com';
const j = async (method, path, body, token) => {
  const r = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const step = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);

const health = (await j('GET', '/health')).json;
step('storage reachable from the server', health.storage === 'ok', health.storage);
if (health.storage !== 'ok') process.exit(1);

const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const start = await j('POST', '/v1/auth/signup/start', { name: 'Upload Check', phone, password: 'upload check 123' });
if (!start.json.devCode) { step('test sign-up (needs Development mode)', false, JSON.stringify(start.json)); process.exit(1); }
const { accessToken } = (await j('POST', '/v1/auth/signup/verify', { phone, code: start.json.devCode })).json;

const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const t = await j('POST', '/v1/uploads', { purpose: 'avatar', contentType: 'image/webp', size: WEBP.byteLength }, accessToken);
step('signed upload URL issued', t.status === 200, t.json.error?.message);

const { 'Content-Length': _l, ...noLen } = t.json.headers;
const big = await fetch(t.json.uploadUrl, { method: 'PUT', headers: noLen, body: Buffer.alloc(WEBP.byteLength + 50) });
step('R2 rejects a file of a different size', !big.ok, `HTTP ${big.status}`);
const html = await fetch(t.json.uploadUrl, { method: 'PUT', headers: { ...t.json.headers, 'Content-Type': 'text/html' }, body: WEBP });
step('R2 rejects a different content type', !html.ok, `HTTP ${html.status}`);

const put = await fetch(t.json.uploadUrl, { method: 'PUT', headers: t.json.headers, body: WEBP });
step('upload straight to R2', put.ok, `HTTP ${put.status} ${put.ok ? '' : (await put.text()).slice(0, 200)}`);

const me = await j('PUT', '/v1/me/avatar', { key: t.json.key }, accessToken);
step('photo attached to the account', me.status === 200 && !!me.json.avatarUrl, me.json.avatarUrl ?? me.json.error?.message);

if (me.json.avatarUrl) {
  const pub = await fetch(me.json.avatarUrl);
  step('photo readable at its public URL', pub.ok, `HTTP ${pub.status} ${pub.headers.get('content-type') ?? ''}`);
}
const del = await j('DELETE', '/v1/me/avatar', undefined, accessToken);
step('photo removed again', del.status === 200 && del.json.avatarUrl === null);
