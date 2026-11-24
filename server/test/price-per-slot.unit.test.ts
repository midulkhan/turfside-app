/** Prices per slot (migration 029) and the plain-words validation messages. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { friendlyMessage } from '../src/lib/friendly-errors';
import { priceFor } from '../src/lib/time';
import { venueInput } from '../src/services/owner';
import { startingPrice, type VenueRow } from '../src/services/venues';

const tk = (n: number) => n * 100;
const SAT = '2026-11-21'; // dow 6
const base: VenueRow = {
  id: 'v', name: 'T', area: 'A', city: 'Dhaka', address: 'Addr', lat: 23.7, lng: 90.4, formats: ['5-a-side'], floodlit: false,
  amenities: [], rules: [], about: '', cancellation_policy: '', rating: '0', review_count: 0,
  open_min: 0, close_min: 1440, session_min: 120, break_min: 0, standard_hourly: tk(1700), weekday_hourly: {}, special_dates: {},
  photos: null, pitch_id: 'p',
};

describe('price per slot', () => {
  const r = { standardHourly: tk(3400), weekdayHourly: { '6': tk(4000) }, specialDates: {}, bands: [{ from: 360, to: 600, hourly: tk(2500), days: [] }] };
  it('per slot: a session costs the rate, whatever its length', () => {
    expect(priceFor({ ...r, per: 'slot' }, '2026-11-24', { start: 0, end: 120 })).toBe(tk(3400)); // Tue, standard
    expect(priceFor({ ...r, per: 'slot' }, '2026-11-24', { start: 0, end: 90 })).toBe(tk(3400));
    expect(priceFor({ ...r, per: 'slot' }, SAT, { start: 0, end: 120 })).toBe(tk(4000)); // weekday price
    expect(priceFor({ ...r, per: 'slot' }, '2026-11-24', { start: 360, end: 480 })).toBe(tk(2500)); // time-of-day
  });
  it('per hour (turfs not saved since): unchanged, rate × length', () => {
    expect(priceFor(r, '2026-11-24', { start: 0, end: 120 })).toBe(tk(6800));
    expect(priceFor({ ...r, per: 'hour' }, '2026-11-24', { start: 0, end: 90 })).toBe(tk(5100));
  });
  it('starting price for a per-slot turf is the session price and its length', () => {
    const v: VenueRow = { ...base, standard_hourly: tk(3400), price_per: 'slot' };
    expect(startingPrice(v, SAT, 0)).toEqual({ per: 'session', amount: tk(3400), minutes: 120 });
    expect(startingPrice({ ...base, price_per: null }, SAT, 0)).toEqual({ per: 'hour', amount: tk(1700) });
  });
});

describe('validation messages', () => {
  const first = (data: unknown, schema: z.ZodType = venueInput) => friendlyMessage(schema.safeParse(data).error!.issues[0]!, data);
  const ok = {
    name: 'Arena', area: 'Banani', address: 'Road 11, Banani', lat: 23.7, lng: 90.4, formats: ['5-a-side'],
    schedule: { opens: '07:00', closes: '23:00' }, pricing: { hourly: 1500 },
  };
  it('names the field and says what to do, never zod wording', () => {
    expect(first({ ...ok, pricing: { hourly: 1500.5 } })).toBe('Standard price: Use whole taka only, with no decimals (e.g. 1500).');
    expect(first({ ...ok, pricing: { hourly: 50 } })).toBe('Standard price: Prices must be at least ৳100.');
    expect(first({ ...ok, pricing: {} })).toBe('Standard price is required.');
    expect(first({ ...ok, name: '' })).toBe('Turf name is required.');
    expect(first({ ...ok, name: 'ab' })).toBe('Turf name must be at least 3 characters.');
    expect(first({ ...ok, priceBands: [{ from: '07:00', to: '10:00', hourly: 99.9 }] })).toMatch(/^Time-of-day price: Use whole taka/);
    expect(first({ ...ok, pricing: { hourly: 1500, byWeekday: { fri: 2000.5 } } })).toMatch(/^Weekday price: Use whole taka/);
    expect(first({ ...ok, schedule: { opens: '07:00', closes: '23:00', sessionMinutes: 90.5 } })).toBe('Session length must be a whole number.');
    expect(first({ ...ok, formats: [] })).toBe('Pitch sizes: add at least one.');
    expect(first({ a: 1 }, z.object({ email: z.string().email() }))).toBe('Email is required.');
    expect(first({ email: 'x' }, z.object({ email: z.string().email() }))).toBe('Email: enter a valid email address.');
    expect(first({ amount: 1.5 }, z.object({ amount: z.number().int() }))).toBe('Amount must be a whole number of taka (no decimals).');
  });
});
