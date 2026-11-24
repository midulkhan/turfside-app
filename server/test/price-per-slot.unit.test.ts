/** Prices per slot (migration 029) and the plain-words validation messages. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { friendlyMessage } from '../src/lib/friendly-errors';
import { priceFor, sessionsFor } from '../src/lib/time';
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

describe('time prices are sessions of their own (per slot)', () => {
  const FRI = '2026-11-27';
  const TUE = '2026-11-24';
  const r = {
    openMin: 360, // 6:00 AM
    closeMin: 1350, // 10:30 PM
    lengthMin: 90,
    breakMin: 0,
    mode: 'fixed',
    per: 'slot',
    bands: [
      { from: 450, to: 540, hourly: tk(1260), days: [0, 1, 2, 3, 4] }, // 7:30–9:00 AM Sun–Thu
      { from: 1170, to: 1290, hourly: tk(1660), days: [5, 6] }, // 7:30–9:30 PM Fri, Sat
    ],
  };
  const times = (day: string) => sessionsFor(r, day).map((s) => `${s.start}-${s.end}`);
  it('a Friday: the 7:30–9:30 PM time price is one 2-hour session; the rest are 90 minutes', () => {
    expect(times(FRI)).toEqual(['360-450', '450-540', '540-630', '630-720', '720-810', '810-900', '900-990', '990-1080', '1080-1170', '1170-1290']);
    const p = { standardHourly: tk(1500), weekdayHourly: { '5': tk(2000) }, specialDates: {}, bands: r.bands, per: 'slot' };
    expect(priceFor(p, FRI, { start: 1170, end: 1290 })).toBe(tk(1660));
    expect(priceFor(p, FRI, { start: 1080, end: 1170 })).toBe(tk(2000));
  });
  it('the grid moves around a time price that doesn’t line up with it', () => {
    const odd = { ...r, bands: [{ from: 420, to: 480, hourly: tk(1000), days: [] }] }; // 7:00–8:00 AM, 1 hour
    expect(sessionsFor(odd, TUE).slice(0, 4).map((s) => `${s.start}-${s.end}`)).toEqual(['420-480', '480-570', '570-660', '660-750']); // 6:00–7:00 is too short for 90 min
    // With a 15-minute break: next to the time price too.
    const brk = { ...odd, breakMin: 15 };
    expect(sessionsFor(brk, TUE).slice(0, 3).map((s) => `${s.start}-${s.end}`)).toEqual(['420-480', '495-585', '600-690']);
  });
  it('per hour (turfs not saved since) keeps the old grid', () => {
    expect(sessionsFor({ ...r, per: 'hour' }, FRI).map((s) => `${s.start}-${s.end}`)).toContain('1170-1260');
  });
});
