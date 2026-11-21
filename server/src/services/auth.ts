import { hit } from '../cache';
import { config, isProd } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { getDummyHash, hashPassword, hmac, otpCode, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto';
import { codeEmail, emailEnabled, sendEmail } from '../lib/email';
import { sendSms } from '../lib/sms';
import { publicUrl, storageEnabled } from '../lib/storage';
import { signAccess } from '../lib/tokens';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_DAYS = 30;

type Purpose = 'signup' | 'reset' | 'phone_change' | 'login';
type UserRow = { id: string; name: string; phone: string; email: string | null; roles: string[]; password_hash: string; avatar_key?: string | null };

/**
 * Two kinds of account, kept apart: players (`users`, the player app) and turf owners
 * (`owners`, the owner dashboard). Same flows, separate tables, sessions, codes and tokens.
 */
export type Realm = 'player' | 'owner';
export const TABLES = {
  player: { users: 'users', sessions: 'sessions', cols: 'id, name, phone, email, roles, password_hash, avatar_key' },
  owner: { users: 'owners', sessions: 'owner_sessions', cols: "id, name, phone, email, '{owner}'::text[] roles, password_hash, avatar_key" },
} as const;
const T = (r: Realm) => TABLES[r];
/** Code hashes and rate-limit keys: owner ones are namespaced (player ones unchanged). */
const ns = (r: Realm, s: string) => (r === 'owner' ? `owner:${s}` : s);

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
async function guardOtp(phone: string, purpose: Purpose, ip: string, realm: Realm) {
  if ((await hit(`otp:phone:${ns(realm, phone)}`, 3600)) > config.OTP_PHONE_LIMIT) throw new ApiError('rate_limited', 'Too many codes requested. Try again in an hour.');
  if ((await hit(`otp:ip:${ip}`, 3600)) > config.OTP_IP_LIMIT) throw new ApiError('rate_limited', 'Too many requests. Try again later.');
  const last = await one<{ created_at: Date }>('select created_at from otp_codes where phone = $1 and purpose = $2 and realm = $3 order by created_at desc limit 1', [phone, purpose, realm]);
  if (last && Date.now() - new Date(last.created_at).getTime() < config.OTP_RESEND_SECONDS * 1000) throw new ApiError('rate_limited', 'Please wait a few seconds before requesting another code.');
}

const maskEmail = (e: string) => {
  const [user, domain] = e.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
};
/** SMS goes out for real only with a gateway; outside production the console stands in. */
const smsReady = () => config.SMS_PROVIDER === 'http' || !isProd;

/**
 * Makes a code and delivers it. Sign-up and password reset codes go by **email only** (Sender);
 * SMS is used just for confirming a new phone number, and for an old account with no email.
 * The reply says where it went (the app shows "sent to mi****@gmail.com").
 * Outside production, if the email can't go out, the code comes back in the reply so the app
 * can still be tested (the app shows it as "Test code"). In production that is an error.
 */
async function issueOtp(
  phone: string,
  purpose: Purpose,
  payload: unknown,
  ip: string,
  to: { email?: string | null; name?: string } = {},
  realm: Realm = 'player',
) {
  await guardOtp(phone, purpose, ip, realm);
  const code = otpCode();
  await q('update otp_codes set consumed_at = now() where phone = $1 and purpose = $2 and realm = $3 and consumed_at is null', [phone, purpose, realm]);
  await q("insert into otp_codes (phone, purpose, realm, code_hash, payload, expires_at) values ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))", [
    phone,
    purpose,
    realm,
    hmac(otpSecret(), ns(realm, `${phone}:${purpose}:${code}`)),
    payload ? JSON.stringify(payload) : null,
    OTP_TTL_MIN,
  ]);
  const byEmail = !!to.email && purpose !== 'phone_change';
  const channels: ('email' | 'sms')[] = [];
  let failure: unknown = null;
  if (byEmail) {
    try {
      if (!emailEnabled()) throw new ApiError('not_configured', 'Email isn’t set up on the server.');
      const mail = codeEmail({ name: to.name, code, minutes: OTP_TTL_MIN, purpose: purpose === 'signup' ? 'signup' : purpose === 'login' ? 'login' : 'reset' });
      await sendEmail({ to: to.email!, toName: to.name, ...mail });
      channels.push('email');
    } catch (e) {
      failure = e;
    }
  } else if (smsReady() || purpose === 'phone_change') {
    try {
      await sendSms(phone, `${code} is your TurfSides code. It expires in ${OTP_TTL_MIN} minutes. Never share it.`);
      channels.push('sms');
    } catch (e) {
      failure = e;
    }
  }
  const where = { sent: true as const, channels, ...(byEmail ? { email: maskEmail(to.email!) } : {}) };
  if (channels.length) return isProd || channels.includes('email') ? where : { ...where, devCode: code };
  if (!isProd) return { ...where, devCode: code }; // testing only: nothing went out, show the code
  await q('update otp_codes set consumed_at = now() where phone = $1 and purpose = $2 and realm = $3 and consumed_at is null', [phone, purpose, realm]);
  throw failure instanceof ApiError && failure.code !== 'not_configured'
    ? failure
    : new ApiError('not_configured', 'We couldn’t email your code right now. Try again in a moment.');
}

async function consumeOtp(phone: string, purpose: Purpose, code: string, realm: Realm = 'player') {
  return tx(async (c) => {
    const row = (
      await c.query<{ id: string; code_hash: string; attempts: number; payload: unknown; expires_at: Date }>(
        'select id, code_hash, attempts, payload, expires_at from otp_codes where phone = $1 and purpose = $2 and realm = $3 and consumed_at is null order by created_at desc limit 1 for update',
        [phone, purpose, realm],
      )
    ).rows[0];
    if (!row || new Date(row.expires_at) < new Date()) throw new ApiError('invalid', 'That code has expired. Request a new one.');
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError('rate_limited', 'Too many attempts. Request a new code.');
    if (!safeEqual(row.code_hash, hmac(otpSecret(), ns(realm, `${phone}:${purpose}:${code}`)))) {
      await c.query('update otp_codes set attempts = attempts + 1 where id = $1', [row.id]);
      throw new ApiError('invalid', 'That code is not right. Try again.');
    }
    await c.query('update otp_codes set consumed_at = now() where id = $1', [row.id]);
    return row.payload as Record<string, unknown> | null;
  });
}

async function createSession(u: UserRow, meta: { ip: string; ua?: string; device?: string }, realm: Realm = 'player') {
  const refresh = randomToken(32);
  const s = await one<{ id: string }>(
    `insert into ${T(realm).sessions} (user_id, refresh_hash, expires_at, user_agent, ip, device) values ($1,$2, now() + make_interval(days => $3), $4, $5, $6) returning id`,
    [u.id, sha256(refresh), REFRESH_DAYS, meta.ua?.slice(0, 200) ?? null, meta.ip, meta.device ?? null],
  );
  return { user: publicUser(u), accessToken: await signAccess(u.id, u.roles, s!.id, realm), refreshToken: refresh };
}

// ── Sign up: details → emailed code → account ──────────────────────────────────
export async function signupStart(input: { name: string; phone: string; email: string; password: string }, ip: string, realm: Realm = 'player') {
  // Say plainly when the number or email already has an account (and which), so people go
  // to sign in instead of waiting for a code that never comes. Scraping is held back by the
  // per-minute auth rate limit (no hourly per-IP cap: mobile carriers put many people on one IP).
  const taken = await one<{ phone: boolean; email: boolean }>(
    `select bool_or(phone = $1) phone, bool_or(lower(email) = lower($2)) email from ${T(realm).users} where phone = $1 or lower(email) = lower($2)`,
    [input.phone, input.email],
  );
  if (taken?.phone) throw new ApiError('conflict', 'This mobile number already has an account. Sign in instead.', 'phone');
  if (taken?.email) throw new ApiError('conflict', 'This email already has an account. Sign in instead.', 'email');
  const passwordHash = await hashPassword(input.password);
  return issueOtp(input.phone, 'signup', { name: input.name, email: input.email, passwordHash }, ip, { email: input.email, name: input.name }, realm);
}

export async function signupVerify(phone: string, code: string, meta: { ip: string; ua?: string; device?: string }, realm: Realm = 'player') {
  const p = (await consumeOtp(phone, 'signup', code, realm)) as { name: string; email: string | null; passwordHash: string } | null;
  if (!p) throw new ApiError('invalid', 'Start sign-up again.');
  try {
    const u =
      realm === 'owner'
        ? await one<UserRow>(
            `insert into owners (name, phone, email, password_hash, phone_verified_at) values ($1,$2,$3,$4, now()) returning ${T('owner').cols}`,
            [p.name, phone, p.email, p.passwordHash],
          )
        : await one<UserRow>(
            `insert into users (name, phone, email, password_hash, roles, phone_verified_at) values ($1,$2,$3,$4,'{player}', now()) returning ${T('player').cols}`,
            [p.name, phone, p.email, p.passwordHash],
          );
    return createSession(u!, meta, realm);
  } catch (e) {
    // Someone took the number or email between the code being sent and now.
    if ((e as { code?: string; constraint?: string }).code === '23505') {
      const onEmail = /email/.test((e as { constraint?: string }).constraint ?? '');
      throw new ApiError('conflict', onEmail ? 'This email already has an account. Sign in instead.' : 'This mobile number already has an account. Sign in instead.', onEmail ? 'email' : 'phone');
    }
    throw e;
  }
}

// ── Sign in ─────────────────────────────────────────────────────────────────
export async function login(
  identifier: { kind: 'phone' | 'email'; value: string },
  password: string,
  meta: { ip: string; ua?: string; device?: string },
  realm: Realm = 'player',
) {
  if ((await hit(`login:${ns(realm, identifier.value)}`, 900)) > 10) throw new ApiError('rate_limited', 'Too many attempts. Try again in 15 minutes.');
  const u = await one<UserRow & { two_factor: boolean }>(
    `select ${T(realm).cols}, two_factor from ${T(realm).users} where ${identifier.kind === 'phone' ? 'phone' : 'email'} = $1 and deleted_at is null`,
    [identifier.value],
  );
  const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()));
  if (!u || !ok) throw new ApiError('unauthorized', 'Mobile number, email or password is incorrect.');
  // Two-step sign-in is the player's choice (Settings, off by default). Off: the password is enough.
  if (!u.two_factor || !u.email) return createSession(u, meta, realm);
  // On: the password is right, now a code goes to the account's email. The app gets a
  // short-lived signed challenge (never the phone or user id) to verify it with.
  const sent = await issueOtp(u.phone, 'login', { userId: u.id }, meta.ip, { email: u.email, name: u.name }, realm);
  return { otpRequired: true as const, challenge: loginChallenge(u.phone, realm), ...sent };
}

/** Signed "this person passed the password step" token: phone + expiry, base64url, HMAC'd. */
function loginChallenge(phone: string, realm: Realm) {
  const body = Buffer.from(`${phone}.${Math.floor(Date.now() / 1000) + OTP_TTL_MIN * 60 + 60}`).toString('base64url');
  return `${body}.${hmac(otpSecret(), ns(realm, `login-challenge:${body}`))}`;
}
function readChallenge(challenge: string, realm: Realm) {
  const [body, sig] = challenge.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(otpSecret(), ns(realm, `login-challenge:${body}`)))) throw new ApiError('invalid', 'Sign in again to get a new code.');
  const [phone, exp] = Buffer.from(body, 'base64url').toString().split('.');
  if (!phone || !(Number(exp) * 1000 > Date.now())) throw new ApiError('invalid', 'That code has expired. Sign in again.');
  return phone;
}

/** Step 2 of sign-in: the emailed code opens the session. */
export async function loginVerify(challenge: string, code: string, meta: { ip: string; ua?: string; device?: string }, realm: Realm = 'player') {
  const phone = readChallenge(challenge, realm);
  const payload = (await consumeOtp(phone, 'login', code, realm)) as { userId?: string } | null;
  const u = payload?.userId
    ? await one<UserRow>(`select ${T(realm).cols} from ${T(realm).users} where id = $1 and phone = $2 and deleted_at is null`, [payload.userId, phone])
    : null;
  if (!u) throw new ApiError('invalid', 'Sign in again to get a new code.');
  return createSession(u, meta, realm);
}

/** "Send a new code" on the sign-in code screen. */
export async function loginResend(challenge: string, ip: string, realm: Realm = 'player') {
  const phone = readChallenge(challenge, realm);
  const u = await one<{ id: string; email: string | null; name: string }>(`select id, email, name from ${T(realm).users} where phone = $1 and deleted_at is null`, [phone]);
  if (!u) throw new ApiError('invalid', 'Sign in again to get a new code.');
  const sent = await issueOtp(phone, 'login', { userId: u.id }, ip, { email: u.email, name: u.name }, realm);
  return { otpRequired: true as const, challenge: loginChallenge(phone, realm), ...sent };
}

/** Refresh-token rotation with reuse detection: a stolen, already-used token revokes the whole family. */
export async function refresh(token: string, meta: { ip: string; ua?: string; device?: string }, realm: Realm = 'player') {
  const S = T(realm).sessions;
  const s = await one<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }>(
    `select id, user_id, expires_at, revoked_at, replaced_by from ${S} where refresh_hash = $1`,
    [sha256(token)],
  );
  if (!s) throw new ApiError('unauthorized', 'Please sign in again.');
  // An already-rotated token coming back means it was copied: end every session (theft response).
  if (s.replaced_by) {
    await q(`update ${S} set revoked_at = now() where user_id = $1 and revoked_at is null`, [s.user_id]);
    throw new ApiError('unauthorized', 'Please sign in again.');
  }
  // Simply signed out (this device, or from another device): just ask to sign in again.
  if (s.revoked_at) throw new ApiError('unauthorized', 'Please sign in again.');
  if (new Date(s.expires_at) < new Date()) throw new ApiError('unauthorized', 'Please sign in again.');
  const u = await one<UserRow>(`select ${T(realm).cols} from ${T(realm).users} where id = $1 and deleted_at is null`, [s.user_id]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  const next = await createSession(u, meta, realm);
  const nextId = await one<{ id: string }>(`select id from ${S} where refresh_hash = $1`, [sha256(next.refreshToken)]);
  await q(`update ${S} set replaced_by = $2, revoked_at = now() where id = $1`, [s.id, nextId!.id]);
  // The phone's push registration belongs to the login, not to one rotation of it: carry it over,
  // or pushes stop a few minutes after opening the app (the old session reads as signed out).
  if (realm === 'player') await q('update push_tokens set session_id = $2 where session_id = $1', [s.id, nextId!.id]);
  return next;
}

export async function logout(sessionId: string, realm: Realm = 'player') {
  await q(`update ${T(realm).sessions} set revoked_at = now() where id = $1`, [sessionId]);
  if (realm === 'player') await q('delete from push_tokens where session_id = $1', [sessionId]); // no pushes to a signed-out phone
  return { ok: true };
}

// ── Password reset ──────────────────────────────────────────────────────────
/** The sign-in number behind an account email (emails are stored lower-case and unique). */
export async function phoneForEmail(email: string, realm: Realm = 'player') {
  const u = await one<{ phone: string }>(`select phone from ${T(realm).users} where lower(email) = lower($1) and deleted_at is null`, [email]);
  return u?.phone ?? null;
}

export async function resetStart(phone: string, ip: string, realm: Realm = 'player') {
  const u = await one<{ email: string | null; name: string }>(`select email, name from ${T(realm).users} where phone = $1 and deleted_at is null`, [phone]);
  if (!u) return { sent: true }; // no account discovery here
  return issueOtp(phone, 'reset', null, ip, { email: u.email, name: u.name }, realm);
}

export async function resetVerify(phone: string, code: string, newPassword: string, meta: { ip: string; ua?: string; device?: string }, realm: Realm = 'player') {
  await consumeOtp(phone, 'reset', code, realm);
  const hash = await hashPassword(newPassword);
  const u = await one<UserRow>(
    `update ${T(realm).users} set password_hash = $2, updated_at = now() where phone = $1 and deleted_at is null returning ${T(realm).cols}`,
    [phone, hash],
  );
  if (!u) throw new ApiError('invalid', 'Account not found.');
  await q(`update ${T(realm).sessions} set revoked_at = now() where user_id = $1 and revoked_at is null`, [u.id]); // sign out everywhere
  return createSession(u, meta, realm);
}

export async function me(userId: string, realm: Realm = 'player') {
  const u = await one<UserRow>(`select ${T(realm).cols} from ${T(realm).users} where id = $1 and deleted_at is null`, [userId]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return publicUser(u);
}

// ── Edit profile ────────────────────────────────────────────────────────────
export async function updateProfile(userId: string, input: { name: string }, realm: Realm = 'player') {
  const u = await one<UserRow>(
    `update ${T(realm).users} set name = $2, updated_at = now() where id = $1 and deleted_at is null returning ${T(realm).cols}`,
    [userId, input.name],
  );
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return publicUser(u);
}

/**
 * Change phone, step 1: confirm it's really you (password), then text a code to the new number.
 * The number is your sign-in, so it only changes once the new one is proven to be yours.
 */
export async function phoneChangeStart(userId: string, phone: string, password: string, ip: string, realm: Realm = 'player') {
  const u = await one<UserRow>(`select ${T(realm).cols} from ${T(realm).users} where id = $1 and deleted_at is null`, [userId]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new ApiError('invalid', 'Your password is incorrect.');
  if (u.phone === phone) throw new ApiError('invalid', 'That is already your number.');
  if (await one(`select 1 from ${T(realm).users} where phone = $1`, [phone])) throw new ApiError('conflict', 'This number is already used by another account.');
  return issueOtp(phone, 'phone_change', { userId }, ip, {}, realm);
}

/** Change phone, step 2: the code from the new number. Tells the old number it was changed. */
export async function phoneChangeVerify(userId: string, phone: string, code: string, realm: Realm = 'player') {
  const p = (await consumeOtp(phone, 'phone_change', code, realm)) as { userId?: string } | null;
  if (!p || p.userId !== userId) throw new ApiError('invalid', 'That code is not right. Try again.');
  const old = await one<{ phone: string }>(`select phone from ${T(realm).users} where id = $1`, [userId]);
  try {
    const u = await one<UserRow>(
      `update ${T(realm).users} set phone = $2, phone_verified_at = now(), updated_at = now() where id = $1 and deleted_at is null returning ${T(realm).cols}`,
      [userId, phone],
    );
    if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
    await q("insert into audit_log(action, entity, entity_id, data) values ($2, $3, $1, '{}')", [
      userId,
      realm === 'owner' ? 'owner.phone_changed' : 'user.phone_changed',
      realm === 'owner' ? 'owner' : 'user',
    ]);
    if (old?.phone) await sendSms(old.phone, 'Your TurfSides number was changed. If this wasn\'t you, contact support right away.').catch(() => {});
    return publicUser(u);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('conflict', 'This number is already used by another account.');
    throw e;
  }
}
