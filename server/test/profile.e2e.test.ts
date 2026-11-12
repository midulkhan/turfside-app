/**
 * Edit profile: change your name; change your phone (password + SMS code to the new number).
 *   API_URL=… npm test
 */
import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: Json = {};
  try {
    json = JSON.parse(await res.text());
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}
const phone = () => `18${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
async function newUser(name: string) {
  const p = phone();
  const start = await call('POST', '/v1/auth/signup/start', { name, phone: p, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'correct horse 1' });
  return { ...((await call('POST', '/v1/auth/signup/verify', { phone: p, code: start.json.devCode })).json as { accessToken: string; user: Json }), phone: p };
}

d('edit profile', () => {
  it('changes the name', async () => {
    const u = await newUser('Old Name');
    expect((await call('PATCH', '/v1/me', { name: 'x' }, u.accessToken)).status).toBe(400);
    const r = await call('PATCH', '/v1/me', { name: '  New Name ' }, u.accessToken);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.name).toBe('New Name');
    expect((await call('GET', '/v1/me', undefined, u.accessToken)).json.name).toBe('New Name');
  });

  it('changes the phone only after the password and a code sent to the new number', async () => {
    const u = await newUser('Phone Changer');
    const other = await newUser('Someone Else');
    const next = phone();
    expect((await call('POST', '/v1/me/phone/start', { phone: next, password: 'wrong' }, u.accessToken)).status).toBe(400);
    expect((await call('POST', '/v1/me/phone/start', { phone: other.phone, password: 'correct horse 1' }, u.accessToken)).status).toBe(409);
    const start = await call('POST', '/v1/me/phone/start', { phone: next, password: 'correct horse 1' }, u.accessToken);
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    // Someone else can't use that code for their account.
    expect((await call('POST', '/v1/me/phone/verify', { phone: next, code: '000000' }, u.accessToken)).status).toBe(400);
    const ok = await call('POST', '/v1/me/phone/verify', { phone: next, code: start.json.devCode }, u.accessToken);
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.phone).toBe(next);
    // The new number signs in; the old one doesn't.
    expect((await call('POST', '/v1/auth/login', { identifier: next, password: 'correct horse 1' })).status).toBe(200);
    expect((await call('POST', '/v1/auth/login', { identifier: u.phone, password: 'correct horse 1' })).status).toBe(401);
  });
});
