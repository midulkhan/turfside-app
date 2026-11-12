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

// ── Entry pass v2: the ticket itself, signed ─────────────────────────────────

/**
 * What a v2 pass carries. Plain JSON so any scanner (and the admin app) can read and show it
 * without a network round trip; the signature proves it came from us and wasn't edited.
 * Keys are short-but-readable to keep the QR small enough to scan off a phone screen.
 * See docs/pass-qr.md. Amounts are whole taka (BDT); times are Dhaka local.
 */
export type PassTicket = {
  v: 2;
  code: string; // booking code, e.g. TS-261111-6700 (unique)
  venue: string;
  area: string;
  pitch: string;
  format: string; // e.g. 5-a-side
  date: string; // YYYY-MM-DD
  from: string; // HH:MM
  to: string; // HH:MM
  name: string; // who booked
  phone: string; // masked: 017*****907
  paid: number; // taka
  via: string; // payment method
  exp: number; // unix seconds; the pass is void after this
};

const PASS2 = 'TSP2';
const sig2 = (json: string) => hmac(secret('PASS_SECRET'), json).slice(0, 22); // 128-bit, base64url

/** "TSP2.<signature>.<ticket JSON>": the signature first (fixed width), then the readable ticket. */
export function signPass2(t: Omit<PassTicket, 'v'>) {
  const json = JSON.stringify({ v: 2, ...t });
  return `${PASS2}.${sig2(json)}.${json}`;
}

/** Splits a v2 pass without trusting it (for display). */
export function readPass2(token: string): { sig: string; json: string; ticket: PassTicket } | null {
  if (!token.startsWith(`${PASS2}.`)) return null;
  const rest = token.slice(PASS2.length + 1);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  const json = rest.slice(dot + 1);
  try {
    const ticket = JSON.parse(json) as PassTicket;
    return ticket && ticket.v === 2 && typeof ticket.code === 'string' ? { sig: rest.slice(0, dot), json, ticket } : null;
  } catch {
    return null;
  }
}

/** Any pass we issued (v1 or v2), verified and unexpired: what to look up. */
export function verifyAnyPass(token: string): { bookingId: string } | { code: string; ticket: PassTicket } | null {
  if (token.startsWith('tsp1.')) return verifyPass(token);
  const p = readPass2(token);
  if (!p || !safeEqual(p.sig, sig2(p.json))) return null;
  if (!Number.isFinite(p.ticket.exp) || p.ticket.exp * 1000 < Date.now()) return null;
  return { code: p.ticket.code, ticket: p.ticket };
}
