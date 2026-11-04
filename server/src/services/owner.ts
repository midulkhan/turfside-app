import { z } from 'zod';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';

import { invalidateVenue, photoUrl } from './venues';

/**
 * Owner-side turf management (used by the owner app, and by Postman for demo data).
 * Friendly units in the API — taka and "HH:MM" — stored as poisha and minutes.
 */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like "06:00" or "23:30".');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const fromMin = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const taka = z.number().int().min(100, 'Prices are in taka, at least ৳100.').max(100_000);

/** Photos: our own uploads (images.turfsides.com) or the bundled demo pictures. */
const photo = z.string().refine((u) => /^\/static\/seed\/[a-z0-9-]+\.webp$/.test(u) || (!!config.R2_PUBLIC_URL && u.startsWith(`${config.R2_PUBLIC_URL.replace(/\/+$/, '')}/venues/`)), {
  message: 'Photos must be uploaded through TurfSides (images.turfsides.com/venues/…) or a demo photo like /static/seed/venue-arena.webp.',
});

export const venueInput = z.object({
  name: z.string().trim().min(3).max(80),
  area: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(60).default('Dhaka'),
  address: z.string().trim().min(5).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  formats: z.array(z.enum(['5-a-side', '6-a-side', '7-a-side'])).min(1).max(3),
  floodlit: z.boolean().default(false),
  amenities: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  rules: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
  about: z.string().trim().max(1000).default(''),
  cancellationPolicy: z.string().trim().max(300).optional(),
  schedule: z.object({
    opens: hhmm,
    /** If earlier than `opens`, the turf closes after midnight (e.g. opens 06:00, closes 02:00). */
    closes: hhmm,
    sessionMinutes: z.number().int().min(30).max(240).default(60),
    breakMinutes: z.number().int().min(0).max(60).default(0),
  }),
  pricing: z.object({
    hourly: taka,
    /** Different hourly rate on some weekdays, e.g. { "fri": 1800, "sat": 1800 } */
    byWeekday: z.partialRecord(z.enum(DAYS), taka).default({}),
    /** Rate for specific dates, e.g. { "2026-12-16": 2500 } */
    specialDates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taka).default({}),
  }),
  photos: z.array(photo).max(10).default([]),
  status: z.enum(['draft', 'published']).default('published'),
});
export type VenueInput = z.infer<typeof venueInput>;

function scheduleMinutes(s: VenueInput['schedule']) {
  const open = toMin(s.opens);
  let close = toMin(s.closes);
  if (close <= open) close += 1440; // past midnight
  if (close - open < s.sessionMinutes) throw new ApiError('invalid', 'Opening hours are shorter than one session.');
  return { open, close };
}

const weekdayJson = (w: VenueInput['pricing']['byWeekday']) =>
  Object.fromEntries(Object.entries(w).map(([d, v]) => [String(DAYS.indexOf(d as (typeof DAYS)[number])), (v as number) * 100]));
const specialJson = (s: Record<string, number>) => Object.fromEntries(Object.entries(s).map(([d, v]) => [d, v * 100]));

type OwnerRow = {
  id: string;
  name: string;
  area: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  formats: string[];
  floodlit: boolean;
  amenities: string[];
  rules: string[];
  about: string;
  cancellation_policy: string;
  status: string;
  rating: string;
  review_count: number;
  open_min: number;
  close_min: number;
  session_min: number;
  break_min: number;
  standard_hourly: number;
  weekday_hourly: Record<string, number>;
  special_dates: Record<string, number>;
  photos: string[] | null;
};

const OWNER_SELECT = `
  select v.id, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about,
         v.cancellation_policy, v.status, v.rating, v.review_count,
         s.open_min, s.close_min, s.session_min, s.break_min, p.standard_hourly, p.weekday_hourly, p.special_dates,
         (select array_agg(url order by position) from venue_photos ph where ph.venue_id = v.id) photos
    from venues v join venue_schedule s on s.venue_id = v.id join venue_pricing p on p.venue_id = v.id`;

function shape(r: OwnerRow) {
  return {
    id: r.id,
    status: r.status,
    name: r.name,
    area: r.area,
    city: r.city,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    formats: r.formats,
    floodlit: r.floodlit,
    amenities: r.amenities,
    rules: r.rules,
    about: r.about,
    cancellationPolicy: r.cancellation_policy,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    schedule: { opens: fromMin(r.open_min), closes: fromMin(r.close_min), sessionMinutes: r.session_min, breakMinutes: r.break_min },
    pricing: {
      hourly: r.standard_hourly / 100,
      byWeekday: Object.fromEntries(Object.entries(r.weekday_hourly).map(([d, v]) => [DAYS[Number(d)], v / 100])),
      specialDates: Object.fromEntries(Object.entries(r.special_dates).map(([d, v]) => [d, v / 100])),
    },
    photos: (r.photos ?? []).map(photoUrl),
  };
}

export async function listOwnerVenues(ownerId: string) {
  return (await q<OwnerRow>(`${OWNER_SELECT} where v.owner_id = $1 and v.status <> 'suspended' order by v.created_at`, [ownerId])).map(shape);
}

export async function getOwnerVenue(ownerId: string, id: string) {
  const r = await one<OwnerRow>(`${OWNER_SELECT} where v.id = $1 and v.owner_id = $2 and v.status <> 'suspended'`, [id, ownerId]);
  if (!r) throw new ApiError('not_found', 'Turf not found.');
  return shape(r);
}

/** Stored photo value: demo paths stay relative; our R2 URLs are kept as-is. */
const storedPhoto = (u: string) => u;

async function writeDetails(c: import('pg').PoolClient, id: string, v: VenueInput) {
  const { open, close } = scheduleMinutes(v.schedule);
  await c.query(
    `insert into venue_schedule (venue_id, open_min, close_min, session_min, break_min) values ($1,$2,$3,$4,$5)
       on conflict (venue_id) do update set open_min = excluded.open_min, close_min = excluded.close_min, session_min = excluded.session_min, break_min = excluded.break_min`,
    [id, open, close, v.schedule.sessionMinutes, v.schedule.breakMinutes],
  );
  await c.query(
    `insert into venue_pricing (venue_id, standard_hourly, weekday_hourly, special_dates) values ($1,$2,$3,$4)
       on conflict (venue_id) do update set standard_hourly = excluded.standard_hourly, weekday_hourly = excluded.weekday_hourly, special_dates = excluded.special_dates`,
    [id, v.pricing.hourly * 100, JSON.stringify(weekdayJson(v.pricing.byWeekday)), JSON.stringify(specialJson(v.pricing.specialDates))],
  );
  await c.query('delete from venue_photos where venue_id = $1', [id]);
  for (const [i, u] of v.photos.entries()) await c.query('insert into venue_photos (venue_id, url, position) values ($1,$2,$3)', [id, storedPhoto(u), i]);
}

export async function createVenue(ownerId: string, v: VenueInput) {
  const id = await tx(async (c) => {
    const count = (await c.query<{ n: number }>("select count(*)::int n from venues where owner_id = $1 and status <> 'suspended'", [ownerId])).rows[0].n;
    if (count >= 25) throw new ApiError('conflict', 'You can list up to 25 turfs. Contact support for more.');
    const r = await c.query<{ id: string }>(
      `insert into venues (owner_id, name, area, city, address, lat, lng, formats, floodlit, amenities, rules, about, cancellation_policy, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13, 'Free cancellation up to 24 hours before kick-off.'),$14) returning id`,
      [ownerId, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about, v.cancellationPolicy ?? null, v.status],
    );
    const vid = r.rows[0].id;
    await c.query('insert into pitches (venue_id) values ($1)', [vid]);
    await writeDetails(c, vid, v);
    return vid;
  });
  await invalidateVenue(id);
  return getOwnerVenue(ownerId, id);
}

export async function updateVenue(ownerId: string, id: string, v: VenueInput) {
  await tx(async (c) => {
    const r = await c.query(
      `update venues set name=$3, area=$4, city=$5, address=$6, lat=$7, lng=$8, formats=$9, floodlit=$10, amenities=$11, rules=$12, about=$13,
              cancellation_policy=coalesce($14, cancellation_policy), status=$15
        where id = $1 and owner_id = $2 and status <> 'suspended'`,
      [id, ownerId, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about, v.cancellationPolicy ?? null, v.status],
    );
    if (!r.rowCount) throw new ApiError('not_found', 'Turf not found.');
    await writeDetails(c, id, v);
  });
  await invalidateVenue(id);
  return getOwnerVenue(ownerId, id);
}

/** Hide a turf from players. Bookings and history are kept. */
export async function removeVenue(ownerId: string, id: string) {
  const r = await one("update venues set status = 'suspended' where id = $1 and owner_id = $2 and status <> 'suspended' returning id", [id, ownerId]);
  if (!r) throw new ApiError('not_found', 'Turf not found.');
  await invalidateVenue(id);
  return { ok: true };
}
