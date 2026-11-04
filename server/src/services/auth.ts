import { hit } from '../cache';
import { config, isProd } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { getDummyHash, hashPassword, hmac, otpCode, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto';
import { sendSms } from '../lib/sms';
import { publicUrl, storageEnabled } from '../lib/storage';
import { signAccess } from '../lib/tokens';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 30;
const REFRESH_DAYS = 30;

type Purpose = 'signup' | 'reset';
type UserRow = { id: string; name: string; phone: string; email: string | null; roles: string[]; password_hash: string; avatar_key?: string | null };

const otpSecret = () => {
  if (!config.OTP_SECRET) throw new ApiError('not_configured', 'Server secrets are not configured yet.');
  return config.OTP_SECRET;
};

export const publicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email ?? undefined,
  roles: u.roles,
  avatarUrl: u.avatar_key && storageEnabled() ? publicUrl(u.avatar_key) : null,
});

/** Per-phone and per-IP limits on top of the global HTTP rate limit. */
async function guardOtp(phone: string, purpose: Purpose, ip: string) {
  if ((await hit(`otp:phone:${phone}`, 3600)) > 6) throw new ApiError('rate_limited', 'Too many codes requested. Try again in an hour.');
  if ((await hit(`otp:ip:${ip}`, 3600)) > 20) throw new ApiError('rate_limited', 'Too many requests. Try again later.');
  const last = await one<{ created_at: Date }>('select created_at from otp_codes where phone = $1 and purpose = $2 order by created_at desc limit 1', [phone, purpose]);
  if (last && Date.now() - new Date(last.created_at).getTime() < OTP_RESEND_SECONDS * 1000) throw new ApiError('rate_limited', 'Please wait a few seconds before requesting another code.');
}

async function issueOtp(phone: string, purpose: Purpose, payload: unknown, ip: string) {
  await guardOtp(phone, purpose, ip);
  const code = otpCode();
  await q('update otp_codes set consumed_at = now() where phone = $1 and purpose = $2 and consumed_at is null', [phone, purpose]);
  await q("insert into otp_codes (phone, purpose, code_hash, payload, expires_at) values ($1,$2,$3,$4, now() + make_interval(mins => $5))", [
    phone,
    purpose,
    hmac(otpSecret(), `${phone}:${purpose}:${code}`),
    payload ? JSON.stringify(payload) : null,
    OTP_TTL_MIN,
  ]);
  await sendSms(phone, `${code} is your TurfSides code. It expires in ${OTP_TTL_MIN} minutes. Never share it.`);
  // Outside production we return the code so the app can be tested without an SMS gateway.
  return isProd ? { sent: true } : { sent: true, devCode: code };
}

async function consumeOtp(phone: string, purpose: Purpose, code: string) {
  return tx(async (c) => {
    const row = (
      await c.query<{ id: string; code_hash: string; attempts: number; payload: unknown; expires_at: Date }>(
        'select id, code_hash, attempts, payload, expires_at from otp_codes where phone = $1 and purpose = $2 and consumed_at is null order by created_at desc limit 1 for update',
        [phone, purpose],
      )
    ).rows[0];
    if (!row || new Date(row.expires_at) < new Date()) throw new ApiError('invalid', 'That code has expired. Request a new one.');
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError('rate_limited', 'Too many attempts. Request a new code.');
    if (!safeEqual(row.code_hash, hmac(otpSecret(), `${phone}:${purpose}:${code}`))) {
      await c.query('update otp_codes set attempts = attempts + 1 where id = $1', [row.id]);
      throw new ApiError('invalid', 'That code is not right. Try again.');
    }
    await c.query('update otp_codes set consumed_at = now() where id = $1', [row.id]);
    return row.payload as Record<string, unknown> | null;
  });
}

async function createSession(u: UserRow, meta: { ip: string; ua?: string }) {
  const refresh = randomToken(32);
  const s = await one<{ id: string }>(
    "insert into sessions (user_id, refresh_hash, expires_at, user_agent, ip) values ($1,$2, now() + make_interval(days => $3), $4, $5) returning id",
    [u.id, sha256(refresh), REFRESH_DAYS, meta.ua?.slice(0, 200) ?? null, meta.ip],
  );
  return { user: publicUser(u), accessToken: await signAccess(u.id, u.roles, s!.id), refreshToken: refresh };
}

// ── Sign up: details → SMS code → account ──────────────────────────────────
export async function signupStart(input: { name: string; phone: string; email?: string; password: string; role: 'player' | 'owner' }, ip: string) {
  const taken = await one('select 1 from users where phone = $1 or ($2::text is not null and email = $2)', [input.phone, input.email ?? null]);
  // Same response either way, so the endpoint can't be used to discover registered numbers.
  if (taken) return isProd ? { sent: true } : { sent: true, note: 'already registered' };
  const passwordHash = await hashPassword(input.password);
  return issueOtp(input.phone, 'signup', { name: input.name, email: input.email ?? null, passwordHash, role: input.role }, ip);
}

export async function signupVerify(phone: string, code: string, meta: { ip: string; ua?: string }) {
  const p = (await consumeOtp(phone, 'signup', code)) as { name: string; email: string | null; passwordHash: string; role: string } | null;
  if (!p) throw new ApiError('invalid', 'Start sign-up again.');
  const roles = p.role === 'owner' ? ['player', 'owner'] : ['player'];
  try {
    const u = await one<UserRow>(
      'insert into users (name, phone, email, password_hash, roles, phone_verified_at) values ($1,$2,$3,$4,$5, now()) returning id, name, phone, email, roles, password_hash, avatar_key',
      [p.name, phone, p.email, p.passwordHash, roles],
    );
    return createSession(u!, meta);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('conflict', 'This number is already registered. Sign in instead.');
    throw e;
  }
}

// ── Sign in ─────────────────────────────────────────────────────────────────
export async function login(identifier: { kind: 'phone' | 'email'; value: string }, password: string, meta: { ip: string; ua?: string }) {
  if ((await hit(`login:${identifier.value}`, 900)) > 10) throw new ApiError('rate_limited', 'Too many attempts. Try again in 15 minutes.');
  const u = await one<UserRow>(`select id, name, phone, email, roles, password_hash, avatar_key from users where ${identifier.kind === 'phone' ? 'phone' : 'email'} = $1`, [identifier.value]);
  const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()));
  if (!u || !ok) throw new ApiError('unauthorized', 'Mobile number, email or password is incorrect.');
  return createSession(u, meta);
}

/** Refresh-token rotation with reuse detection: a stolen, already-used token revokes the whole family. */
export async function refresh(token: string, meta: { ip: string; ua?: string }) {
  const s = await one<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }>(
    'select id, user_id, expires_at, revoked_at, replaced_by from sessions where refresh_hash = $1',
    [sha256(token)],
  );
  if (!s) throw new ApiError('unauthorized', 'Please sign in again.');
  if (s.revoked_at || s.replaced_by) {
    await q('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [s.user_id]);
    throw new ApiError('unauthorized', 'Please sign in again.');
  }
  if (new Date(s.expires_at) < new Date()) throw new ApiError('unauthorized', 'Please sign in again.');
  const u = await one<UserRow>('select id, name, phone, email, roles, password_hash, avatar_key from users where id = $1', [s.user_id]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  const next = await createSession(u, meta);
  const nextId = await one<{ id: string }>('select id from sessions where refresh_hash = $1', [sha256(next.refreshToken)]);
  await q('update sessions set replaced_by = $2, revoked_at = now() where id = $1', [s.id, nextId!.id]);
  return next;
}

export async function logout(sessionId: string) {
  await q('update sessions set revoked_at = now() where id = $1', [sessionId]);
  return { ok: true };
}

// ── Password reset ──────────────────────────────────────────────────────────
export async function resetStart(phone: string, ip: string) {
  const u = await one('select 1 from users where phone = $1', [phone]);
  if (!u) return { sent: true }; // identical response: no account discovery
  return issueOtp(phone, 'reset', null, ip);
}

export async function resetVerify(phone: string, code: string, newPassword: string, meta: { ip: string; ua?: string }) {
  await consumeOtp(phone, 'reset', code);
  const hash = await hashPassword(newPassword);
  const u = await one<UserRow>('update users set password_hash = $2, updated_at = now() where phone = $1 returning id, name, phone, email, roles, password_hash, avatar_key', [phone, hash]);
  if (!u) throw new ApiError('invalid', 'Account not found.');
  await q('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [u.id]); // sign out everywhere
  return createSession(u, meta);
}

export async function me(userId: string) {
  const u = await one<UserRow>('select id, name, phone, email, roles, password_hash, avatar_key from users where id = $1', [userId]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return publicUser(u);
}
