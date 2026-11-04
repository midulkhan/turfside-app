import { jwtVerify, SignJWT } from 'jose';

import { config } from '../config';
import { ApiError } from '../errors';

import { hmac, safeEqual } from './crypto';

const enc = (s: string) => new TextEncoder().encode(s);
const ACCESS_TTL = '15m';

function secret(name: 'JWT_SECRET' | 'PASS_SECRET') {
  const v = config[name];
  if (!v) throw new ApiError('not_configured', 'Server secrets are not configured yet.');
  return v;
}

/** Short-lived access token. Refresh tokens are opaque and stored hashed in the DB. */
export async function signAccess(userId: string, roles: string[], sessionId: string) {
  return new SignJWT({ roles, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('turfsides')
    .setAudience('turfsides-app')
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(enc(secret('JWT_SECRET')));
}

export async function verifyAccess(token: string) {
  try {
    const { payload } = await jwtVerify(token, enc(secret('JWT_SECRET')), { issuer: 'turfsides', audience: 'turfsides-app', algorithms: ['HS256'] });
    return { userId: String(payload.sub), roles: (payload.roles as string[]) ?? [], sessionId: String(payload.sid) };
  } catch {
    throw new ApiError('unauthorized', 'Please sign in again.');
  }
}

/**
 * Entry-pass token for the QR code: "tsp1.<bookingId>.<expiry>.<signature>".
 * Signed with PASS_SECRET so a screenshot of a booking number can't be forged;
 * the scanner verifies it server-side and checks the booking status (replay-safe).
 */
export function signPass(bookingId: string, expiresAtSec: number) {
  const body = `${bookingId}.${expiresAtSec}`;
  return `tsp1.${body}.${hmac(secret('PASS_SECRET'), body)}`;
}

export function verifyPass(token: string) {
  const [v, id, exp, sig] = token.split('.');
  if (v !== 'tsp1' || !id || !exp || !sig) return null;
  if (!safeEqual(sig, hmac(secret('PASS_SECRET'), `${id}.${exp}`))) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  return { bookingId: id };
}
