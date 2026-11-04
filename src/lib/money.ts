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
