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
