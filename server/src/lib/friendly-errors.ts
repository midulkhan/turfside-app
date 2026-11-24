/**
 * Validation errors in words an owner or player understands: "Standard price must be a whole
 * number of taka (no decimals)." instead of "pricing.hourly: Invalid input: expected int, received
 * number". Messages written for people (custom zod messages) are kept, with the field's name.
 */
import type { z } from 'zod';

/** Field names, by path with list positions as #. */
const LABELS: Record<string, string> = {
  name: 'Turf name',
  area: 'Area',
  city: 'City',
  address: 'Address',
  lat: 'Location',
  lng: 'Location',
  mapUrl: 'Google Maps link',
  formats: 'Pitch sizes',
  'amenities.#': 'Each facility',
  amenities: 'Facilities',
  'rules.#': 'Each arena rule',
  rules: 'Arena rules',
  about: 'About',
  cancellationPolicy: 'Refund policy',
  'schedule.opens': 'Opening time',
  'schedule.closes': 'Closing time',
  'schedule.sessionMinutes': 'Session length',
  'schedule.breakMinutes': 'Break between sessions',
  'pricing.hourly': 'Standard price',
  'pricing.byWeekday.*': 'Weekday price',
  'pricing.specialDates.*': 'Special-date price',
  'priceBands.#.hourly': 'Time-of-day price',
  'priceBands.#.from': 'Time-of-day price start',
  'priceBands.#.to': 'Time-of-day price end',
  priceBands: 'Time-of-day prices',
  'slots.custom.#.price': 'Session price',
  'slots.custom.#.start': 'Session start',
  'slots.custom.#.end': 'Session end',
  'sessionSets.#.name': 'Set name',
  'sessionSets.#.slots.#.price': 'Session price',
  'sessionSets.#.slots.#.start': 'Session start',
  'sessionSets.#.slots.#.end': 'Session end',
  'sessionSets.#.slots': 'Sessions',
  sessionSets: 'Session sets',
  photos: 'Photos',
  'photos.#': 'Photo',
  guestName: 'Customer name',
  guestPhone: 'Phone',
  guestEmail: 'Email',
  amount: 'Amount',
  note: 'Note',
  reason: 'Reason',
  phone: 'Phone',
  email: 'Email',
  password: 'Password',
  code: 'Code',
  title: 'Title',
  fee: 'Entry fee',
  day: 'Date',
  starts: 'Sessions',
};

const pattern = (path: PropertyKey[]) => path.map((p) => (typeof p === 'number' ? '#' : String(p))).join('.');
/** "sessionMinutes" → "Session minutes" */
const words = (s: string) => {
  const w = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export function fieldLabel(path: PropertyKey[]) {
  const p = pattern(path);
  if (LABELS[p]) return LABELS[p];
  // A record key (e.g. pricing.byWeekday.fri): match with *.
  const star = p.replace(/\.[^.#]+$/, '.*');
  if (LABELS[star]) return LABELS[star];
  const last = [...path].reverse().find((x) => typeof x === 'string') as string | undefined;
  return last ? words(last) : 'This field';
}

const isMoney = (label: string) => /price|amount|fee/i.test(label);
const num = (n: unknown) => (typeof n === 'bigint' ? Number(n) : (n as number)).toLocaleString('en-US');
/** zod's own wording, as opposed to a message we wrote. */
const generic = (m: string) => /^(Invalid|Too (small|big)|Expected|Unrecognized|Required)/.test(m) || /expected .*, received/i.test(m);

type Issue = z.core.$ZodIssue;

/** The value at `path` in what was sent (to tell "missing" from "wrong"). */
const valueAt = (data: unknown, path: PropertyKey[]) =>
  path.reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Record<PropertyKey, unknown>)[k] : undefined), data);
const blank = (x: unknown) => x === undefined || x === null || (typeof x === 'string' && !x.trim());

/** `data`: what was sent, if at hand (lets an empty field read "is required"). */
export function friendlyMessage(i: Issue, data?: unknown): string {
  const label = fieldLabel(i.path);
  const sent = data === undefined ? (i as { input?: unknown }).input : valueAt(data, i.path);
  if (blank(sent) && (i.code === 'too_small' || i.code === 'invalid_type' || i.code === 'invalid_format') && !(i.code === 'too_small' && i.origin !== 'string'))
    return `${label} is required.`;
  if (i.message && !generic(i.message)) return `${label}: ${i.message}`;
  const money = isMoney(label);
  switch (i.code) {
    case 'invalid_type': {
      if (i.expected === 'int') return money ? `${label} must be a whole number of taka (no decimals).` : `${label} must be a whole number.`;
      if (i.expected === 'number') return `${label} must be a number.`;
      if (i.expected === 'string') return `${label} must be text.`;
      if (i.expected === 'array') return `${label} must be a list.`;
      return `${label} is not filled in correctly.`;
    }
    case 'too_small': {
      const min = i.minimum;
      if (i.origin === 'string') return Number(min) <= 1 ? `${label} is required.` : `${label} must be at least ${num(min)} characters.`;
      if (i.origin === 'array' || i.origin === 'set') return Number(min) <= 1 ? `${label}: add at least one.` : `${label}: add at least ${num(min)}.`;
      return money ? `${label} must be at least ৳${num(min)}.` : `${label} must be at least ${num(min)}.`;
    }
    case 'too_big': {
      const max = i.maximum;
      if (i.origin === 'string') return `${label} can be at most ${num(max)} characters.`;
      if (i.origin === 'array' || i.origin === 'set') return `${label}: at most ${num(max)}.`;
      return money ? `${label} can be at most ৳${num(max)}.` : `${label} can be at most ${num(max)}.`;
    }
    case 'invalid_format':
      if (i.format === 'email') return `${label}: enter a valid email address.`;
      if (i.format === 'url') return `${label}: enter a full link starting with https://.`;
      return `${label} is not in the right format.`;
    case 'not_multiple_of':
      return `${label} must be a multiple of ${num(i.divisor)}.`;
    case 'invalid_value':
      return `${label}: pick one of the options.`;
    case 'unrecognized_keys':
      return 'Something unexpected was sent. Refresh the page and try again.';
    default:
      return `${label} is not filled in correctly.`;
  }
}
