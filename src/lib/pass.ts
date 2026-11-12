/**
 * Entry pass QR, v2: "TSP2.<signature>.<ticket JSON>" (docs/pass-qr.md).
 * Reading is safe anywhere (it's plain JSON); only the server can confirm the signature, so a
 * scanner shows the ticket at once and then asks POST /v1/passes/verify.
 */
export type PassTicket = {
  v: 2;
  code: string;
  venue: string;
  area: string;
  pitch: string;
  format: string;
  date: string; // YYYY-MM-DD (Dhaka)
  from: string; // HH:MM
  to: string; // HH:MM
  name: string;
  phone: string; // masked
  paid: number; // taka
  via: string;
  exp: number; // unix seconds
};

/** The ticket inside a scanned QR, or null if it isn't a v2 pass. Unverified. */
export function readPass(raw: string): PassTicket | null {
  if (!raw.startsWith('TSP2.')) return null;
  const rest = raw.slice(5);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  try {
    const t = JSON.parse(rest.slice(dot + 1)) as PassTicket;
    return t && t.v === 2 && typeof t.code === 'string' ? t : null;
  } catch {
    return null;
  }
}

/** Past its expiry (by this device's clock; the server re-checks). */
export const passExpired = (t: PassTicket, now = Date.now()) => t.exp * 1000 < now;
