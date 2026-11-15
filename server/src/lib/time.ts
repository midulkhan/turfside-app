/**
 * Venue time model (matches the app): a day is 'YYYY-MM-DD' in Asia/Dhaka
 * (UTC+6, no DST) and a session start is minutes after that local midnight.
 * Starts can exceed 1440 for venues open past midnight.
 */
export const DHAKA_OFFSET_MIN = 360;

export function dhakaToday(now = Date.now()) {
  return new Date(now + DHAKA_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDayKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const dayOfWeek = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Absolute instant for "minutes after Dhaka midnight of `day`". */
export function instant(day: string, minutes: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DHAKA_OFFSET_MIN * 60_000 + minutes * 60_000);
}

export function minutesNowInDhaka(now = Date.now()) {
  return Math.floor((now / 60_000 + DHAKA_OFFSET_MIN) % 1440);
}

export type SessionRule = { openMin: number; closeMin: number; lengthMin: number; breakMin: number };

/** Same algorithm as the owner preview in the app. Never creates a session past closing. */
export function generateSessions({ openMin, closeMin, lengthMin, breakMin }: SessionRule) {
  const out: { start: number; end: number }[] = [];
  if (lengthMin <= 0 || closeMin <= openMin) return out;
  for (let start = openMin; start + lengthMin <= closeMin; start += lengthMin + breakMin) out.push({ start, end: start + lengthMin });
  return out;
}

export type PriceRules = { standardHourly: number; weekdayHourly: Record<string, number>; specialDates: Record<string, number> };

/** Precedence: special date → weekday rule → standard rate. Money is integer poisha. */
export function hourlyFor(r: PriceRules, day: string) {
  return r.specialDates[day] ?? r.weekdayHourly[String(dayOfWeek(day))] ?? r.standardHourly;
}

export const sessionPrice = (hourly: number, lengthMin: number) => Math.round((hourly * lengthMin) / 60);

// ── Flexible slots and time-band prices (owner dashboard) ────────────────────────────────
/**
 * A venue's sessions are either `fixed` (back-to-back sessions of one length from opening to
 * closing, the original model) or `custom` (the owner's own list, e.g. 07:00–08:30, 08:30–10:00,
 * 18:00–19:00), each optionally with its own price. Venues without these settings behave exactly
 * as before.
 */
export type CustomSlot = { start: number; end: number; price?: number | null };
/** A saved session set (minutes, poisha). `days` 0 = Sunday; empty = every day no other live set covers. */
export type SessionSetRow = { id: string; name: string; live: boolean; days?: number[] | null; slots: CustomSlot[] };
export type SlotRules = SessionRule & { mode?: string | null; custom?: CustomSlot[] | null; sets?: SessionSetRow[] | null };

/** Prices for a time of day: `hourly` poisha for sessions starting in [from, to), optionally only on some weekdays (0 = Sunday). */
export type PriceBand = { from: number; to: number; hourly: number; days?: number[] | null };

/**
 * Sessions on `day`. Custom mode with session sets: the live set for that weekday, else the live
 * set without days ("all other days"), else none (closed that day). Without sets: `custom`.
 */
export function sessionsFor(r: SlotRules, day?: string): CustomSlot[] {
  const norm = (l: CustomSlot[]) => [...l].sort((a, b) => a.start - b.start).map((s) => ({ start: s.start, end: s.end, price: s.price ?? null }));
  if (r.mode === 'custom') {
    const live = (r.sets ?? []).filter((x) => x.live);
    if (day && live.length) {
      const dow = dayOfWeek(day);
      const set = live.find((x) => x.days?.includes(dow)) ?? live.find((x) => !x.days?.length);
      return set ? norm(set.slots) : [];
    }
    if (r.custom?.length) return norm(r.custom);
  }
  return generateSessions(r);
}

/**
 * The price of one session on `day`. Precedence: special date → the slot's own price →
 * a time band covering its start → weekday rate → standard rate. Integer poisha.
 */
export function priceFor(r: PriceRules & { bands?: PriceBand[] | null }, day: string, s: CustomSlot) {
  const len = s.end - s.start;
  const special = r.specialDates[day];
  if (special != null) return sessionPrice(special, len);
  if (s.price != null) return s.price;
  const dow = dayOfWeek(day);
  const band = (r.bands ?? []).find((b) => s.start >= b.from && s.start < b.to && (!b.days?.length || b.days.includes(dow)));
  if (band) return sessionPrice(band.hourly, len);
  return sessionPrice(hourlyFor(r, day), len);
}
