/**
 * Money is always handled as integer poisha (1 taka = 100 poisha), never floats.
 * The client only formats amounts; every payable amount comes from the server.
 */
export type Poisha = number & { readonly __brand?: 'poisha' };

const grouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatTaka(amount: Poisha) {
  if (!Number.isSafeInteger(amount)) return '৳—';
  const taka = Math.round(amount / 100);
  return `৳${grouping.format(taka)}`;
}

export const taka = (t: number): Poisha => Math.round(t * 100);

/**
 * "Starting at": the cheapest thing bookable in the next 7 days (server rule). Turfs that price each
 * session show that session's price and length; same-length turfs show a price per hour.
 */
export type StartingPrice = { per: 'session'; amount: Poisha; minutes: number } | { per: 'hour'; amount: Poisha };

/** Older servers only send `hourlyFrom`: read that as per hour. */
export const startingPriceOf = (v: { startingPrice?: StartingPrice | null; hourlyFrom: Poisha }): StartingPrice =>
  v.startingPrice ?? { per: 'hour', amount: v.hourlyFrom };

/** What the price is for. Short: "hr", "2 hrs", "90 min". Long: "hour", "2-hour session", "90-min session". */
export function priceUnit(p: StartingPrice, style: 'short' | 'long' = 'short') {
  if (p.per === 'hour') return style === 'short' ? 'hr' : 'hour';
  const m = p.minutes;
  const h = m / 60;
  if (style === 'short') return m % 60 === 0 ? `${h} ${h === 1 ? 'hr' : 'hrs'}` : `${m} min`;
  return m % 60 === 0 ? `${h}-hour session` : `${m}-min session`;
}
