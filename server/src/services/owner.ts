import { z } from 'zod';

import { config } from '../config';
import { one, q, tx } from '../db';
import { ApiError } from '../errors';

import { invalidateVenue, photoUrl, refLabel, shareUrl } from './venues';

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
  /**
   * Optional (owner dashboard). `fixed` = sessions of `schedule.sessionMinutes` (60, 90, any length);
   * `custom` = exactly these sessions, each optionally with its own price. Times before `opens` are
   * after midnight. Left out = unchanged.
   */
  slots: z
    .object({
      mode: z.enum(['fixed', 'custom']),
      custom: z.array(z.object({ start: hhmm, end: hhmm, price: taka.nullable().optional() })).max(48).default([]),
    })
    .optional(),
  /**
   * Optional named session sets (custom mode). Several can be live when their days don't overlap;
   * at most one live set has no days ("all other days"). Left out = unchanged.
   */
  sessionSets: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(40),
        live: z.boolean().default(false),
        /** Weekdays this set runs on; empty = every day no other live set covers. */
        days: z.array(z.enum(DAYS)).max(7).default([]),
        slots: z.array(z.object({ start: hhmm, end: hhmm, price: taka.nullable().optional() })).min(1).max(48),
      }),
    )
    .max(8)
    .optional(),
  /** Optional time-of-day prices, e.g. [{ from: "07:00", to: "10:00", hourly: 1500 }]. Left out = unchanged. */
  priceBands: z.array(z.object({ from: hhmm, to: hhmm, hourly: taka, days: z.array(z.enum(DAYS)).max(7).default([]) })).max(24).optional(),
});
export type VenueInput = z.infer<typeof venueInput>;

/** Minutes after the venue day's midnight: a time earlier than opening is after midnight. */
const dayMin = (t: string, open: number) => (toMin(t) < open ? toMin(t) + 1440 : toMin(t));

type SlotIn = { start: string; end: string; price?: number | null };

function customSlots(v: VenueInput, input: SlotIn[] = v.slots?.custom ?? [], label = 'slots.custom') {
  const open = toMin(v.schedule.opens);
  const list = input
    .map((x) => {
      const start = dayMin(x.start, open);
      let end = toMin(x.end);
      while (end <= start) end += 1440;
      return { start, end, price: x.price == null ? null : x.price * 100 };
    })
    .sort((a, b) => a.start - b.start);
  if (!list.length) throw new ApiError('invalid', `${label}: Add at least one session.`);
  for (const [i, x] of list.entries()) {
    if (x.end - x.start < 15 || x.end - x.start > 360) throw new ApiError('invalid', `${label}: Sessions must be 15 minutes to 6 hours (${fromMin(x.start)}–${fromMin(x.end)}).`);
    if (x.end > 2880) throw new ApiError('invalid', `${label}: Sessions can run at most until the next day.`);
    const prev = list[i - 1];
    if (prev && x.start < prev.end) throw new ApiError('invalid', `${label}: ${fromMin(prev.start)}–${fromMin(prev.end)} overlaps ${fromMin(x.start)}–${fromMin(x.end)}.`);
  }
  if (list[0]!.start >= 1440) throw new ApiError('invalid', `${label}: The first session must start on the day itself (set "opens" to it).`);
  return list;
}

/** Validated session sets (minutes, poisha) and the live one's sessions. */
function sessionSetsJson(v: VenueInput) {
  const sets = v.sessionSets ?? [];
  if (new Set(sets.map((x) => x.id)).size !== sets.length) throw new ApiError('invalid', 'sessionSets: Each set needs its own id.');
  const live = sets.filter((x) => x.live);
  if (live.filter((x) => !x.days.length).length > 1)
    throw new ApiError('invalid', 'Only one live session set can run on all other days. Pick days for the others.');
  const seen = new Map<string, string>();
  for (const x of live)
    for (const d of x.days) {
      const other = seen.get(d);
      if (other) throw new ApiError('invalid', `"${x.name}" and "${other}" are both live on ${d[0]!.toUpperCase()}${d.slice(1)}. Each day can have one live set.`);
      seen.set(d, x.name);
    }
  return sets.map((x) => ({
    id: x.id,
    name: x.name,
    live: x.live,
    days: [...new Set(x.days)].map((d) => DAYS.indexOf(d)).sort(),
    slots: customSlots(v, x.slots, `Session set "${x.name}"`),
  }));
}

function bandsJson(v: VenueInput) {
  const open = toMin(v.schedule.opens);
  return (v.priceBands ?? []).map((b) => {
    const from = dayMin(b.from, open);
    let to = toMin(b.to);
    while (to <= from) to += 1440;
    return { from, to, hourly: b.hourly * 100, days: b.days.map((d) => DAYS.indexOf(d)) };
  });
}

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
  slot_mode: string;
  custom_slots: { start: number; end: number; price: number | null }[] | null;
  bands: { from: number; to: number; hourly: number; days: number[] | null }[] | null;
  slot_sets: { id: string; name: string; live: boolean; days?: number[] | null; slots: { start: number; end: number; price: number | null }[] }[] | null;
  booking_paused: boolean;
  booking_notice: string | null;
  short_code: string;
  ref_no: number;
  photos: string[] | null;
};

const OWNER_SELECT = `
  select v.id, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about,
         v.cancellation_policy, v.status, v.rating, v.review_count,
         s.open_min, s.close_min, s.session_min, s.break_min, p.standard_hourly, p.weekday_hourly, p.special_dates,
         s.slot_mode, s.custom_slots, p.bands, s.slot_sets, v.booking_paused, v.booking_notice, v.short_code, v.ref_no,
         (select array_agg(url order by position) from venue_photos ph where ph.venue_id = v.id) photos
    from venues v join venue_schedule s on s.venue_id = v.id join venue_pricing p on p.venue_id = v.id`;

function shape(r: OwnerRow) {
  return {
    id: r.id,
    /** "TS-5356" and the share link turfsides.com/FDJV346: given by the database when the turf is created. */
    ref: refLabel(r.ref_no),
    shortCode: r.short_code,
    shareUrl: shareUrl(r.short_code),
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
    slots: {
      mode: r.slot_mode === 'custom' ? ('custom' as const) : ('fixed' as const),
      custom: (r.custom_slots ?? []).map((x) => ({ start: fromMin(x.start), end: fromMin(x.end), price: x.price == null ? null : x.price / 100 })),
    },
    priceBands: (r.bands ?? []).map((b) => ({ from: fromMin(b.from), to: fromMin(b.to), hourly: b.hourly / 100, days: (b.days ?? []).map((d) => DAYS[d]) })),
    sessionSets: (r.slot_sets ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      live: x.live,
      days: (x.days ?? []).map((d) => DAYS[d]),
      slots: x.slots.map((y) => ({ start: fromMin(y.start), end: fromMin(y.end), price: y.price == null ? null : y.price / 100 })),
    })),
    bookingPaused: r.booking_paused,
    bookingNotice: r.booking_notice,
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
  let { open, close } = scheduleMinutes(v.schedule);
  let session = v.schedule.sessionMinutes;
  let brk = v.schedule.breakMinutes;
  const sets = v.sessionSets ? sessionSetsJson(v) : null;
  // With session sets, live sets are what players book (per weekday). custom_slots keeps the
  // "all other days" set (or the first live one) for anything that doesn't ask for a day.
  const live = sets?.find((x) => x.live && !x.days.length) ?? sets?.find((x) => x.live);
  const custom = v.slots?.mode === 'custom' ? (live ? live.slots : customSlots(v)) : null;
  if (custom) {
    // Opening hours follow the sessions; the most common length is shown as "N min each".
    open = custom[0]!.start;
    close = custom.at(-1)!.end;
    const lens = custom.map((x) => x.end - x.start);
    session = Math.min(360, Math.max(15, lens.sort((a, b) => lens.filter((y) => y === b).length - lens.filter((y) => y === a).length)[0]!));
    brk = 0;
  }
  await c.query(
    `insert into venue_schedule (venue_id, open_min, close_min, session_min, break_min) values ($1,$2,$3,$4,$5)
       on conflict (venue_id) do update set open_min = excluded.open_min, close_min = excluded.close_min, session_min = excluded.session_min, break_min = excluded.break_min`,
    [id, open, close, session, brk],
  );
  if (v.slots) await c.query('update venue_schedule set slot_mode = $2, custom_slots = $3 where venue_id = $1', [id, v.slots.mode, custom ? JSON.stringify(custom) : null]);
  if (sets) await c.query('update venue_schedule set slot_sets = $2 where venue_id = $1', [id, JSON.stringify(sets)]);
  await c.query(
    `insert into venue_pricing (venue_id, standard_hourly, weekday_hourly, special_dates) values ($1,$2,$3,$4)
       on conflict (venue_id) do update set standard_hourly = excluded.standard_hourly, weekday_hourly = excluded.weekday_hourly, special_dates = excluded.special_dates`,
    [id, v.pricing.hourly * 100, JSON.stringify(weekdayJson(v.pricing.byWeekday)), JSON.stringify(specialJson(v.pricing.specialDates))],
  );
  if (v.priceBands) await c.query('update venue_pricing set bands = $2 where venue_id = $1', [id, JSON.stringify(bandsJson(v))]);
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

export const bookingPauseInput = z.object({
  paused: z.boolean(),
  notice: z.string().trim().max(200).optional(),
});

/**
 * Pause or resume new bookings. Existing bookings stay; players see the notice and every
 * session as unavailable. Touches the next days in slot_updates so open apps refresh at once.
 */
export async function setBookingPause(ownerId: string, id: string, b: z.infer<typeof bookingPauseInput>) {
  await tx(async (c) => {
    const r = await c.query(
      'update venues set booking_paused = $3, booking_notice = coalesce($4, booking_notice) where id = $1 and owner_id = $2 and status <> \'suspended\'',
      [id, ownerId, b.paused, b.notice === undefined ? null : b.notice || null],
    );
    if (!r.rowCount) throw new ApiError('not_found', 'Turf not found.');
    if (b.notice === '') await c.query('update venues set booking_notice = null where id = $1', [id]);
    await c.query(
      `insert into slot_updates(venue_id, day, xid)
         select $1, d::date, pg_current_xact_id()
           from generate_series((now() at time zone 'Asia/Dhaka')::date - 1, (now() at time zone 'Asia/Dhaka')::date + $2::int, interval '1 day') d
       on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid`,
      [id, config.BOOKING_HORIZON_DAYS],
    );
    await c.query('insert into audit_log(actor_id, action, entity, entity_id, data) values ($1,$2,$3,$4,$5)', [
      ownerId,
      b.paused ? 'venue.booking_pause' : 'venue.booking_resume',
      'venue',
      id,
      JSON.stringify({ notice: b.notice ?? null }),
    ]);
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
