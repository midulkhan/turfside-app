import type { Booking } from '@/features/api/types';

import { formatRange } from './time';

/** The slots of a booking that still stand (cancelled ones dropped), or just the booking itself. */
export function liveSlots(b: Pick<Booking, 'day' | 'start' | 'end' | 'group'>) {
  const g = (b.group ?? []).filter((s) => s.status !== 'cancelled');
  return g.length ? g : [{ day: b.day, start: b.start, end: b.end }];
}

/**
 * Times of a booking in one line: "6:00–9:00 PM" when its slots run back to back on one day,
 * otherwise the first slot "+ 2 more".
 */
export function timesLabel(b: Pick<Booking, 'day' | 'start' | 'end' | 'group'>) {
  const s = liveSlots(b);
  if (s.length === 1) return formatRange(s[0].start, s[0].end);
  const joined = s.every((x, i) => i === 0 || (x.day === s[i - 1].day && x.start === s[i - 1].end));
  return joined ? formatRange(s[0].start, s[s.length - 1].end) : `${formatRange(s[0].start, s[0].end)} + ${s.length - 1} more`;
}

/** "2 slots" for a multi-slot booking, else ''. */
export const slotsCount = (b: Pick<Booking, 'group'>) => {
  const n = (b.group ?? []).filter((s) => s.status !== 'cancelled').length;
  return n > 1 ? `${n} slots` : '';
};

export const totalPaid = (b: Pick<Booking, 'amountPaid' | 'orderTotal'>) => b.orderTotal ?? b.amountPaid;
