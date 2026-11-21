/** "Starting at" on turf cards and pages: the cheapest thing a player can actually book. */
import { describe, expect, it } from 'vitest';

import { startingPrice, type VenueRow } from '../src/services/venues';

const tk = (n: number) => n * 100; // poisha
const base: VenueRow = {
  id: 'v_test', name: 'Test', area: 'Savar', city: 'Dhaka', address: 'Dhaka, Savar', lat: 23.78, lng: 90.41,
  formats: ['7-a-side'], floodlit: true, amenities: [], rules: [], about: '', cancellation_policy: '', rating: '0', review_count: 0,
  open_min: 0, close_min: 1440, session_min: 120, break_min: 0, standard_hourly: tk(2000), weekday_hourly: {}, special_dates: {}, photos: null, pitch_id: 'p_test',
};
// The turf from the report: main set every other day, 2-hour sessions ৳2,000–৳5,000; Sunday-only set, 1 hour ৳50,000.
const main = [
  [0, 120, 3400], [140, 260, 2500], [280, 400, 2000], [420, 540, 4000], [560, 680, 4000], [700, 820, 4500], [840, 960, 5000],
].map(([start, end, price]) => ({ start, end, price: tk(price) }));
const kickoff: VenueRow = {
  ...base,
  slot_mode: 'custom',
  slot_sets: [
    { id: 'a', name: 'Main sessions', live: true, days: [], slots: main },
    { id: 'b', name: 'Set 2', live: true, days: [0], slots: [{ start: 0, end: 60, price: tk(50000) }] },
  ],
};
const SAT = '2026-11-21';
const SUN = '2026-11-22';

describe('starting price', () => {
  it('custom sessions: the cheapest real session and its length, not a per-hour figure', () => {
    expect(startingPrice(kickoff, SAT, 0)).toEqual({ per: 'session', amount: tk(2000), minutes: 120 });
  });
  it('is the same whichever day it is asked on (looks 7 days ahead)', () => {
    expect(startingPrice(kickoff, SUN, 0)).toEqual({ per: 'session', amount: tk(2000), minutes: 120 });
  });
  it('skips sessions that have already started today', () => {
    // Saturday 7:30 AM: the ৳2,000 4:40 AM session has gone, but next week's days still have it.
    expect(startingPrice(kickoff, SAT, 450)).toEqual({ per: 'session', amount: tk(2000), minutes: 120 });
    // A Saturday-only set at 5:00 AM: the ৳500 1:00 AM session has gone and next Saturday is 7 days
    // away (outside the window), so the cheapest bookable is today's ৳900 at 10:00 AM.
    const once: VenueRow = { ...kickoff, slot_sets: [{ id: 'x', name: 'X', live: true, days: [6], slots: [{ start: 60, end: 120, price: tk(500) }, { start: 600, end: 660, price: tk(900) }] }] };
    expect(startingPrice(once, SAT, 300)).toEqual({ per: 'session', amount: tk(900), minutes: 60 });
    expect(startingPrice(once, SAT, 0)).toEqual({ per: 'session', amount: tk(500), minutes: 60 });
  });
  it('same-length sessions: lowest per hour across the week (weekday prices count)', () => {
    const fixed: VenueRow = { ...base, slot_mode: 'fixed', weekday_hourly: { '2': tk(1500) } }; // Tuesday cheaper
    expect(startingPrice(fixed, SAT, 0)).toEqual({ per: 'hour', amount: tk(1500) });
    expect(startingPrice({ ...base, slot_mode: 'fixed' }, SAT, 0)).toEqual({ per: 'hour', amount: tk(2000) });
  });
  it('no sessions in the next 7 days falls back to the standard hourly rate', () => {
    const closed: VenueRow = { ...kickoff, slot_sets: [{ id: 'z', name: 'Z', live: true, days: [3], slots: [] }] };
    expect(startingPrice(closed, SAT, 0)).toEqual({ per: 'hour', amount: tk(2000) });
  });
});
