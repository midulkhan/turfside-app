import { ApiError } from '../errors';
import { hashPassword, randomToken, verifyPassword } from '../lib/crypto';
import { deleteObject } from '../lib/storage';
import { dhakaToday } from '../lib/time';
import { one, q, tx } from '../db';

/** Access tokens are short-lived JWTs; sensitive actions also require the session to still be live. */
export async function assertLiveSession(sessionId: string) {
  // Follow refresh rotation to the device's current row; that row must not be revoked.
  const end = await one<{ ok: boolean }>(
    `with recursive chain as (select id, replaced_by, revoked_at, expires_at from sessions where id = $1
       union all select s.id, s.replaced_by, s.revoked_at, s.expires_at from sessions s join chain c on s.id = c.replaced_by)
     select (revoked_at is null and expires_at > now()) ok from chain where replaced_by is null limit 1`,
    [sessionId],
  );
  if (!end?.ok) throw new ApiError('unauthorized', 'Please sign in again.');
}

// ── Settings ────────────────────────────────────────────────────────────────
export async function getSettings(userId: string) {
  const u = await one<{ notify_enabled: boolean; two_factor: boolean; email: string | null }>(
    'select notify_enabled, two_factor, email from users where id = $1 and deleted_at is null',
    [userId],
  );
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return { notifications: u.notify_enabled, twoFactor: u.two_factor, hasEmail: !!u.email };
}

export async function updateSettings(userId: string, patch: { notifications?: boolean; twoFactor?: boolean }) {
  if (patch.notifications !== undefined)
    await q('update users set notify_enabled = $2, updated_at = now() where id = $1 and deleted_at is null', [userId, patch.notifications]);
  if (patch.twoFactor !== undefined) {
    if (patch.twoFactor) {
      // Codes go by email: there must be an address to send them to.
      const u = await one<{ email: string | null }>('select email from users where id = $1 and deleted_at is null', [userId]);
      if (!u?.email) throw new ApiError('invalid', 'Add an email address to your account first. Sign-in codes are sent there.');
    }
    await q('update users set two_factor = $2, updated_at = now() where id = $1 and deleted_at is null', [userId, patch.twoFactor]);
  }
  return getSettings(userId);
}

// ── Signed-in devices ───────────────────────────────────────────────────────
/** Each device keeps exactly one live row (refresh rotation replaces it), so live rows = devices. */
export async function listSessions(userId: string, currentId: string) {
  const rows = await q<{ id: string; device: string | null; user_agent: string | null; created_at: Date; replaced_by: string | null }>(
    `select id, device, user_agent, created_at, replaced_by from sessions
      where user_id = $1 and revoked_at is null and replaced_by is null and expires_at > now()
      order by created_at desc limit 20`,
    [userId],
  );
  // The caller's token may point at a row that was just rotated: its live successor is "this device".
  const current = await one<{ id: string }>(
    `with recursive chain as (select id, replaced_by from sessions where id = $1
       union all select s.id, s.replaced_by from sessions s join chain c on s.id = c.replaced_by)
     select id from chain where replaced_by is null limit 1`,
    [currentId],
  );
  return rows.map((r) => ({
    id: r.id,
    device: r.device || deviceFromUa(r.user_agent),
    lastActive: new Date(r.created_at).getTime(),
    current: r.id === (current?.id ?? currentId),
  }));
}

function deviceFromUa(ua: string | null) {
  if (!ua) return 'Unknown device';
  if (/okhttp/i.test(ua) || /Android/i.test(ua)) return 'Android phone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/CFNetwork|Darwin|iPhone/i.test(ua)) return 'iPhone';
  if (/Mozilla/i.test(ua)) return 'Web browser';
  return 'Unknown device';
}

export async function revokeSession(userId: string, id: string) {
  const r = await q('update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id', [id, userId]);
  if (!r.length) throw new ApiError('not_found', 'That device is already signed out.');
  return { ok: true };
}

/** Sign out every other device; the caller's own device chain stays signed in. */
export async function revokeOtherSessions(userId: string, currentId: string) {
  const keep = (await listSessions(userId, currentId)).find((s) => s.current)?.id ?? currentId;
  const r = await q('update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null returning id', [userId, keep]);
  return { signedOut: r.length };
}

// ── Password ────────────────────────────────────────────────────────────────
export async function changePassword(userId: string, currentId: string, current: string, next: string) {
  const u = await one<{ password_hash: string }>('select password_hash from users where id = $1 and deleted_at is null', [userId]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new ApiError('invalid', 'Your current password is incorrect.');
  if (current === next) throw new ApiError('invalid', 'Choose a new password that’s different from the current one.');
  await q('update users set password_hash = $2, updated_at = now() where id = $1', [userId, await hashPassword(next)]);
  // A changed password signs out every other device (this one stays signed in).
  const { signedOut } = await revokeOtherSessions(userId, currentId);
  return { ok: true, signedOut };
}

// ── Delete account ──────────────────────────────────────────────────────────
/**
 * Permanently deletes the account: personal data is erased and every session ends.
 * The user row stays as an anonymous record because past bookings and payments (which the
 * turf and our accounting need) point at it. Refused while a game is still ahead.
 */
export async function deleteAccount(userId: string, password: string) {
  const u = await one<{ password_hash: string; avatar_key: string | null; roles: string[] }>(
    'select password_hash, avatar_key, roles from users where id = $1 and deleted_at is null',
    [userId],
  );
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  if (!(await verifyPassword(password, u.password_hash))) throw new ApiError('invalid', 'That password is incorrect.');
  if (u.roles.includes('owner'))
    throw new ApiError('conflict', 'This account manages a turf. Contact support to close a turf owner account.');
  const upcoming = await one<{ n: number }>(
    "select count(*)::int n from bookings where user_id = $1 and status in ('confirmed','checked_in') and day >= $2",
    [userId, dhakaToday()],
  );
  if (upcoming && upcoming.n > 0)
    throw new ApiError('conflict', `You have ${upcoming.n === 1 ? 'an upcoming booking' : `${upcoming.n} upcoming bookings`}. Cancel ${upcoming.n === 1 ? 'it' : 'them'} or wait until ${upcoming.n === 1 ? 'it’s' : 'they’re'} played, then delete your account.`);

  await tx(async (c) => {
    // Free anything in the cart straight away.
    await c.query(
      `with o as (update orders set status = 'expired', hold_expires_at = now() where user_id = $1 and status in ('held','pending') returning id)
       update bookings b set status = 'expired', hold_expires_at = now() from o where b.order_id = o.id and b.status in ('held','pending')`,
      [userId],
    );
    await c.query('delete from saved_venues where user_id = $1', [userId]);
    await c.query('delete from user_places where user_id = $1', [userId]);
    await c.query('delete from notifications where user_id = $1', [userId]);
    await c.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
    await c.query(
      `update users set name = 'Deleted user', phone = null, email = null, avatar_key = null,
              password_hash = $2, notify_enabled = false, deleted_at = now(), updated_at = now()
        where id = $1`,
      [userId, await hashPassword(randomToken())],
    );
  });
  if (u.avatar_key) await deleteObject(u.avatar_key).catch(() => {});
  return { deleted: true };
}
