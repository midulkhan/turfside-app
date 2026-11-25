/**
 * Partial payment at checkout: 500 tk per slot in the app, the rest at the turf. Amounts are
 * poisha. Commission is still on the full price (see migration 032).
 */
export const PARTIAL_PER_SLOT = 50_000;

export type PayMode = 'full' | 'partial';

/** What a slot of `total` costs now: all of it, or 500 tk (never more than its price). */
export const payNow = (total: number, mode: PayMode) => (mode === 'partial' ? Math.min(total, PARTIAL_PER_SLOT) : total);

/** For checkout: whether partial makes a difference, and what it means for these slot prices. */
export function partialQuote(slotTotals: number[]) {
  const total = slotTotals.reduce((t, x) => t + x, 0);
  const now = slotTotals.reduce((t, x) => t + payNow(x, 'partial'), 0);
  return { available: now < total, perSlot: PARTIAL_PER_SLOT, now, atTurf: total - now };
}
