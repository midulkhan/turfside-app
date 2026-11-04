import type { Poisha } from './money';

/**
 * Session generation — mirrors the server algorithm so owners see an exact
 * preview. The server remains the source of truth for real slots and prices.
 *
 * Example: open 16:00, close 22:00, 90 min, no break →
 *   16:00–17:30, 17:30–19:00, 19:00–20:30, 20:30–22:00
 * A session that would run past closing is never created.
 */
export type SessionRule = {
  openMin: number; // minutes after midnight
  closeMin: number; // may be > 1440 for venues closing after midnight
  lengthMin: number;
  breakMin: number;
};

export function generateSessions({ openMin, closeMin, lengthMin, breakMin }: SessionRule) {
  const out: { start: number; end: number }[] = [];
  if (lengthMin <= 0 || closeMin <= openMin) return out;
  for (let start = openMin; start + lengthMin <= closeMin; start += lengthMin + breakMin) {
    out.push({ start, end: start + lengthMin });
  }
  return out;
}

/** Session price = hourly rate × minutes ÷ 60, in whole poisha (rounded half-up). */
export function sessionPrice(hourly: Poisha, lengthMin: number): Poisha {
  return Math.round((hourly * lengthMin) / 60);
}

export type PriceRules = {
  standardHourly: Poisha;
  weekdayHourly: Partial<Record<number, Poisha>>; // 0=Sun … 6=Sat
  specialDates: Record<string, Poisha>; // 'YYYY-MM-DD' → hourly
};

/** Precedence: special date → weekday rule → standard rate. (Slot overrides are applied server-side.) */
export function hourlyFor(rules: PriceRules, day: string, dow: number): Poisha {
  return rules.specialDates[day] ?? rules.weekdayHourly[dow] ?? rules.standardHourly;
}
