/**
 * Photo uploads against an S3-compatible server that verifies SigV4 signatures
 * (s3rver locally / in CI, R2 in production). Runs when STORAGE_TEST=1.
 * s3rver doesn't verify presigned signatures, so the tamper checks only run
 * against real R2 (STORAGE_STRICT=1).
 */
import { describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API && process.env.STORAGE_TEST === '1' ? describe : describe.skip;
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

async function newUser(role: 'player' | 'owner' = 'player') {
  const phone = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const s = await call('POST', '/v1/auth/signup/start', { name: 'Photo Tester', phone, email: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@test.turfsides.dev`, password: 'photo pass 123', role });
  return (await call('POST', '/v1/auth/signup/verify', { phone, code: s.json.devCode })).json as { accessToken: string; user: Json };
}

// A tiny but real WebP (1×1).
const WEBP = Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));

d('photo uploads', () => {
  it('reports storage on /health', async () => {
    expect((await call('GET', '/health')).json.storage).toBe('ok');
  });

  it('signs an upload, accepts only the exact file, and sets the avatar', async () => {
    const a = await newUser();
    const up = await call('POST', '/v1/uploads', { purpose: 'avatar', contentType: 'image/webp', size: WEBP.byteLength }, a.accessToken);
    expect(up.status).toBe(200);
    expect(up.json.key).toMatch(new RegExp(`^avatars/${a.user.id}/[0-9a-f-]{36}\\.webp$`));

    // Tampered upload (different size than signed) is rejected by the storage signature check.
    if (process.env.STORAGE_STRICT === '1') {
      const { 'Content-Length': _len, ...rest } = up.json.headers;
      const bigger = await fetch(up.json.uploadUrl, { method: 'PUT', headers: rest, body: new Uint8Array(WEBP.byteLength + 10) });
      expect(bigger.ok).toBe(false);
      const html = await fetch(up.json.uploadUrl, { method: 'PUT', headers: { ...up.json.headers, 'Content-Type': 'text/html' }, body: WEBP });
      expect(html.ok).toBe(false);
    }

    // Attaching before the file exists fails.
    expect((await call('PUT', '/v1/me/avatar', { key: up.json.key }, a.accessToken)).status).toBe(400);

    const ok = await fetch(up.json.uploadUrl, { method: 'PUT', headers: up.json.headers, body: WEBP });
    expect(ok.status).toBe(200);
    const me = await call('PUT', '/v1/me/avatar', { key: up.json.key }, a.accessToken);
    expect(me.status).toBe(200);
    expect(me.json.avatarUrl).toMatch(/\/avatars\/.+\.webp$/);
    expect((await call('GET', '/v1/me', undefined, a.accessToken)).json.avatarUrl).toBe(me.json.avatarUrl);

    // Someone else can't claim this user's photo.
    const b = await newUser();
    expect((await call('PUT', '/v1/me/avatar', { key: up.json.key }, b.accessToken)).status).toBe(403);

    const cleared = await call('DELETE', '/v1/me/avatar', undefined, a.accessToken);
    expect(cleared.json.avatarUrl).toBeNull();
  });

  it('lets owners upload turf photos and use them on a turf', async () => {
    const player = await newUser();
    expect((await call('POST', '/v1/uploads', { purpose: 'venue', contentType: 'image/webp', size: WEBP.byteLength }, player.accessToken)).status).toBe(403);
    const owner = await newUser('owner');
    const up = await call('POST', '/v1/uploads', { purpose: 'venue', contentType: 'image/webp', size: WEBP.byteLength }, owner.accessToken);
    expect(up.json.key).toMatch(new RegExp(`^venues/${owner.user.id}/`));
    expect((await fetch(up.json.uploadUrl, { method: 'PUT', headers: up.json.headers, body: WEBP })).status).toBe(200);
  });

  it('validates upload requests', async () => {
    const a = await newUser();
    expect((await call('POST', '/v1/uploads', { purpose: 'avatar', contentType: 'image/gif', size: 10 }, a.accessToken)).status).toBe(400);
    expect((await call('POST', '/v1/uploads', { purpose: 'avatar', contentType: 'image/webp', size: 6 * 1024 * 1024 }, a.accessToken)).status).toBe(400);
    expect((await call('POST', '/v1/uploads', { purpose: 'avatar', contentType: 'image/webp', size: 10 })).status).toBe(401);
  });
});
