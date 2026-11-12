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
const OTP_RESEND_SECONDS = 30;
const REFRESH_DAYS = 30;

type Purpose = 'signup' | 'reset' | 'phone_change';
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
  if ((await hit(`otp:ip:${ip}`, 3600)) > config.OTP_IP_LIMIT) throw new ApiError('rate_limited', 'Too many requests. Try again later.');
  const last = await one<{ created_at: Date }>('select created_at from otp_codes where phone = $1 and purpose = $2 order by created_at desc limit 1', [phone, purpose]);
  if (last && Date.now() - new Date(last.created_at).getTime() < OTP_RESEND_SECONDS * 1000) throw new ApiError('rate_limited', 'Please wait a few seconds before requesting another code.');
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
async function issueOtp(phone: string, purpose: Purpose, payload: unknown, ip: string, to: { email?: string | null; name?: string } = {}) {
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
  const byEmail = !!to.email && purpose !== 'phone_change';
  const channels: ('email' | 'sms')[] = [];
  let failure: unknown = null;
  if (byEmail) {
    try {
      if (!emailEnabled()) throw new ApiError('not_configured', 'Email isn’t set up on the server.');
      const mail = codeEmail({ name: to.name, code, minutes: OTP_TTL_MIN, purpose: purpose === 'signup' ? 'signup' : 'reset' });
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
  await q('update otp_codes set consumed_at = now() where phone = $1 and purpose = $2 and consumed_at is null', [phone, purpose]);
  throw failure instanceof ApiError && failure.code !== 'not_configured'
    ? failure
    : new ApiError('not_configured', 'We couldn’t email your code right now. Try again in a moment.');
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

async function createSession(u: UserRow, meta: { ip: string; ua?: string; device?: string }) {
  const refresh = randomToken(32);
  const s = await one<{ id: string }>(
    "insert into sessions (user_id, refresh_hash, expires_at, user_agent, ip, device) values ($1,$2, now() + make_interval(days => $3), $4, $5, $6) returning id",
    [u.id, sha256(refresh), REFRESH_DAYS, meta.ua?.slice(0, 200) ?? null, meta.ip, meta.device ?? null],
  );
  return { user: publicUser(u), accessToken: await signAccess(u.id, u.roles, s!.id), refreshToken: refresh };
}

// ── Sign up: details → emailed code → account ──────────────────────────────────
export async function signupStart(input: { name: string; phone: string; email: string; password: string; role: 'player' | 'owner' }, ip: string) {
  // Say plainly when the number or email already has an account (and which), so people go
  // to sign in instead of waiting for a code that never comes. Scraping is held back by the
  // per-minute auth rate limit (no hourly per-IP cap: mobile carriers put many people on one IP).
  const taken = await one<{ phone: boolean; email: boolean }>(
    'select bool_or(phone = $1) phone, bool_or(lower(email) = lower($2)) email from users where phone = $1 or lower(email) = lower($2)',
    [input.phone, input.email],
  );
  if (taken?.phone) throw new ApiError('conflict', 'This mobile number already has an account. Sign in instead.', 'phone');
  if (taken?.email) throw new ApiError('conflict', 'This email already has an account. Sign in instead.', 'email');
  const passwordHash = await hashPassword(input.password);
  return issueOtp(input.phone, 'signup', { name: input.name, email: input.email, passwordHash, role: input.role }, ip, { email: input.email, name: input.name });
}

export async function signupVerify(phone: string, code: string, meta: { ip: string; ua?: string; device?: string }) {
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
    // Someone took the number or email between the code being sent and now.
    if ((e as { code?: string; constraint?: string }).code === '23505') {
      const onEmail = /email/.test((e as { constraint?: string }).constraint ?? '');
      throw new ApiError('conflict', onEmail ? 'This email already has an account. Sign in instead.' : 'This mobile number already has an account. Sign in instead.', onEmail ? 'email' : 'phone');
    }
    throw e;
  }
}

// ── Sign in ─────────────────────────────────────────────────────────────────
export async function login(identifier: { kind: 'phone' | 'email'; value: string }, password: string, meta: { ip: string; ua?: string; device?: string }) {
  if ((await hit(`login:${identifier.value}`, 900)) > 10) throw new ApiError('rate_limited', 'Too many attempts. Try again in 15 minutes.');
  const u = await one<UserRow>(`select id, name, phone, email, roles, password_hash, avatar_key from users where ${identifier.kind === 'phone' ? 'phone' : 'email'} = $1`, [identifier.value]);
  const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()));
  if (!u || !ok) throw new ApiError('unauthorized', 'Mobile number, email or password is incorrect.');
  return createSession(u, meta);
}

/** Refresh-token rotation with reuse detection: a stolen, already-used token revokes the whole family. */
export async function refresh(token: string, meta: { ip: string; ua?: string; device?: string }) {
  const s = await one<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }>(
    'select id, user_id, expires_at, revoked_at, replaced_by from sessions where refresh_hash = $1',
    [sha256(token)],
  );
  if (!s) throw new ApiError('unauthorized', 'Please sign in again.');
  // An already-rotated token coming back means it was copied: end every session (theft response).
  if (s.replaced_by) {
    await q('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [s.user_id]);
    throw new ApiError('unauthorized', 'Please sign in again.');
  }
  // Simply signed out (this device, or from another device): just ask to sign in again.
  if (s.revoked_at) throw new ApiError('unauthorized', 'Please sign in again.');
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
  const u = await one<{ email: string | null; name: string }>('select email, name from users where phone = $1 and deleted_at is null', [phone]);
  if (!u) return { sent: true }; // no account discovery here
  return issueOtp(phone, 'reset', null, ip, { email: u.email, name: u.name });
}

export async function resetVerify(phone: string, code: string, newPassword: string, meta: { ip: string; ua?: string; device?: string }) {
  await consumeOtp(phone, 'reset', code);
  const hash = await hashPassword(newPassword);
  const u = await one<UserRow>('update users set password_hash = $2, updated_at = now() where phone = $1 returning id, name, phone, email, roles, password_hash, avatar_key', [phone, hash]);
  if (!u) throw new ApiError('invalid', 'Account not found.');
  await q('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [u.id]); // sign out everywhere
  return createSession(u, meta);
}

export async function me(userId: string) {
  const u = await one<UserRow>('select id, name, phone, email, roles, password_hash, avatar_key from users where id = $1 and deleted_at is null', [userId]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return publicUser(u);
}

// ── Edit profile ────────────────────────────────────────────────────────────
const COLS = 'id, name, phone, email, roles, password_hash, avatar_key';

export async function updateProfile(userId: string, input: { name: string }) {
  const u = await one<UserRow>(`update users set name = $2, updated_at = now() where id = $1 and deleted_at is null returning ${COLS}`, [userId, input.name]);
  if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
  return publicUser(u);
}

/**
 * Change phone, step 1: confirm it's really you (password), then text a code to the new number.
 * The number is your sign-in, so it only changes once the new one is proven to be yours.
 */
export async function phoneChangeStart(userId: string, phone: string, password: string, ip: string) {
  const u = await one<UserRow>(`select ${COLS} from users where id = $1 and deleted_at is null`, [userId]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new ApiError('invalid', 'Your password is incorrect.');
  if (u.phone === phone) throw new ApiError('invalid', 'That is already your number.');
  if (await one('select 1 from users where phone = $1', [phone])) throw new ApiError('conflict', 'This number is already used by another account.');
  return issueOtp(phone, 'phone_change', { userId }, ip);
}

/** Change phone, step 2: the code from the new number. Tells the old number it was changed. */
export async function phoneChangeVerify(userId: string, phone: string, code: string) {
  const p = (await consumeOtp(phone, 'phone_change', code)) as { userId?: string } | null;
  if (!p || p.userId !== userId) throw new ApiError('invalid', 'That code is not right. Try again.');
  const old = await one<{ phone: string }>('select phone from users where id = $1', [userId]);
  try {
    const u = await one<UserRow>(`update users set phone = $2, phone_verified_at = now(), updated_at = now() where id = $1 and deleted_at is null returning ${COLS}`, [
      userId,
      phone,
    ]);
    if (!u) throw new ApiError('unauthorized', 'Please sign in again.');
    await q("insert into audit_log(action, entity, entity_id, data) values ('user.phone_changed', 'user', $1, '{}')", [userId]);
    if (old?.phone) await sendSms(old.phone, 'Your TurfSides number was changed. If this wasn\'t you, contact support right away.').catch(() => {});
    return publicUser(u);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('conflict', 'This number is already used by another account.');
    throw e;
  }
}
