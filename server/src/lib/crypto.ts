import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

/** Password hashing with scrypt (built into Node — no native addon to compile on the server). */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? reject(e) : resolve(k))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, , , , saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64url'));
  const expected = Buffer.from(keyB64, 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash to compare against when the user doesn't exist, so timing doesn't reveal accounts. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password-' + randomBytes(8).toString('hex')));

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('base64url');
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
