/**
 * Notifications list paging: the app loads 10 at a time as you scroll. Pages must never skip or
 * repeat items, even when many were created in the same instant; no `limit` keeps the old shape.
 * Needs API_URL + DATABASE_URL (notifications are inserted directly).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL;
const d = API && process.env.DATABASE_URL ? describe : describe.skip;
type Json = Record<string, any>;

async function call(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const phone = () => `17${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

d('notifications paging', () => {
  let db: pg.Client;
  let token = '';
  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const p = phone();
    const post = (path: string, body: unknown) =>
      fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<Json>);
    const start = await post('/v1/auth/signup/start', { name: 'Paging Pat', phone: p, email: `n${Date.now().toString(36)}@test.turfsides.dev`, password: 'correct horse 1' });
    const v = await post('/v1/auth/signup/verify', { phone: p, code: start.devCode });
    token = v.accessToken;
    // 25 notifications: 12 share one timestamp (the tricky case), the rest a second apart.
    await db.query(
      `insert into notifications (user_id, kind, title, body, created_at)
       select $1, 'promo', 'N' || g, 'body', case when g <= 12 then now() - interval '1 hour' else now() - make_interval(secs => g) end
         from generate_series(1, 25) g`,
      [v.user.id],
    );
  });
  afterAll(async () => db?.end());

  it('pages of 10 cover every notification once, newest first', async () => {
    const seen: string[] = [];
    let before = '';
    let pages = 0;
    for (;;) {
      const r = await call(`/v1/me/notifications?limit=10${before ? `&before=${encodeURIComponent(before)}` : ''}`, token);
      expect(r.status).toBe(200);
      seen.push(...r.json.map((n: Json) => n.id));
      pages++;
      if (r.json.length < 10) break;
      before = r.json.at(-1).cursor;
    }
    expect(pages).toBe(3); // 10 + 10 + 5
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);

    // No limit: the old response (latest 50) is unchanged.
    const all = await call('/v1/me/notifications', token);
    expect(all.json.map((n: Json) => n.id)).toEqual(seen);
    expect(all.json[0].at).toBeGreaterThanOrEqual(all.json[1].at);

    expect((await call('/v1/me/notifications?limit=10&before=nope', token)).status).toBe(400);
    expect((await call('/v1/me/notifications?limit=500', token)).status).toBe(400);
  });
});
