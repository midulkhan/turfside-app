import { cached, cacheDel } from '../cache';
import { config } from '../config';
import { one, q } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, generateSessions, hourlyFor, instant, minutesNowInDhaka, sessionPrice, type PriceRules } from '../lib/time';

export type VenueRow = {
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
  pitch_id: string;
};

const VENUE_SELECT = `
  select v.id, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about,
         v.cancellation_policy, v.rating, v.review_count,
         s.open_min, s.close_min, s.session_min, s.break_min,
         p.standard_hourly, p.weekday_hourly, p.special_dates,
         (select array_agg(url order by position) from venue_photos ph where ph.venue_id = v.id) as photos,
         (select id from pitches pi where pi.venue_id = v.id order by name limit 1) as pitch_id
  from venues v
  join venue_schedule s on s.venue_id = v.id
  join venue_pricing p on p.venue_id = v.id
  where v.status = 'published'`;

export const photoUrl = (u: string) => (u.startsWith('/') ? `${config.PUBLIC_URL}${u}` : u);
export const rules = (v: VenueRow): PriceRules => ({ standardHourly: v.standard_hourly, weekdayHourly: v.weekday_hourly, specialDates: v.special_dates });

/** Venue static data changes rarely → cached 5 minutes. */
export function getVenueRow(id: string) {
  return cached(`venue:${id}`, 300, async () => {
    const v = await one<VenueRow>(`${VENUE_SELECT} and v.id = $1`, [id]);
    if (!v) throw new ApiError('not_found', 'This turf is no longer listed.');
    return v;
  });
}

export const allVenueRows = () => cached('venues:all', 120, () => q<VenueRow>(VENUE_SELECT));
export const invalidateVenue = (id: string) => cacheDel(`venue:${id}`, 'venues:all');

/**
 * held = someone is checking out right now (10-minute hold or bKash in progress);
 * mine = the signed-in player's own hold, which they can resume (holdId).
 */
export type SlotStatus = 'available' | 'booked' | 'blocked' | 'held' | 'mine';
export type SlotOut = { id: string; start: number; end: number; price: number; status: SlotStatus; holdId?: string };

/**
 * Slots for one day, computed from the schedule (no pre-generated slot rows) and
 * overlaid with active bookings and owner blocks. Cached 15 s and invalidated on
 * every booking change, so availability is fresh but cheap under load.
 */
export async function daySlots(v: VenueRow, day: string, viewerId?: string): Promise<SlotOut[]> {
  const today = dhakaToday();
  if (day < today || day > addDays(today, config.BOOKING_HORIZON_DAYS)) return [];
  const taken = await cached(`taken:${v.id}:${day}`, 15, async () => {
    const from = instant(day, 0);
    const to = instant(day, v.close_min + 60);
    const rows = await q<{ s: Date; e: Date; kind: string; id: string | null; user_id: string | null; until: Date | null }>(
      `select lower(during) s, upper(during) e,
              case when status in ('held','pending') then 'held' else 'booked' end kind, coalesce(order_id, id) id, user_id, hold_expires_at until
         from bookings
        where pitch_id = $1 and during && tstzrange($2, $3) and status in ('held','pending','confirmed','checked_in')
          and not (status in ('held','pending') and hold_expires_at < now())
       union all
       select lower(during), upper(during), 'blocked', null, null, null from venue_blocks where pitch_id = $1 and during && tstzrange($2, $3)`,
      [v.pitch_id, from, to],
    );
    return rows.map((r) => ({
      s: new Date(r.s).getTime(),
      e: new Date(r.e).getTime(),
      kind: r.kind,
      id: r.id,
      userId: r.user_id,
      until: r.until ? new Date(r.until).getTime() : null,
    }));
  });
  const hourly = hourlyFor(rules(v), day);
  const nowMin = minutesNowInDhaka();
  return generateSessions({ openMin: v.open_min, closeMin: v.close_min, lengthMin: v.session_min, breakMin: v.break_min })
    .filter(({ start }) => day !== today || start > nowMin)
    .map(({ start, end }) => {
      const s = instant(day, start).getTime();
      const e = instant(day, end).getTime();
      // Holds stay cached up to 15 s; drop any that ran out in the meantime.
      const clash = taken.find((t) => t.s < e && t.e > s && !(t.kind === 'held' && t.until !== null && t.until < Date.now()));
      const base = { id: `${v.id}:${day}:${start}`, start, end, price: sessionPrice(hourly, v.session_min) };
      if (!clash) return { ...base, status: 'available' as const };
      if (clash.kind === 'held' && viewerId && clash.userId === viewerId) return { ...base, status: 'mine' as const, holdId: clash.id! };
      return { ...base, status: clash.kind as SlotStatus };
    });
}

export const invalidateDay = (venueId: string, day: string) => cacheDel(`taken:${venueId}:${day}`, `explore-avail:${venueId}`);

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function summary(v: VenueRow, opts: { lat?: number; lng?: number; saved?: boolean; availableToday?: boolean }) {
  const day = dhakaToday();
  return {
    id: v.id,
    name: v.name,
    area: v.area,
    city: v.city,
    distanceKm: opts.lat == null || opts.lng == null ? null : Math.round(haversineKm(opts.lat, opts.lng, v.lat, v.lng) * 10) / 10,
    rating: Number(v.rating),
    reviewCount: v.review_count,
    formats: v.formats,
    floodlit: v.floodlit,
    hourlyFrom: hourlyFor(rules(v), day),
    availableToday: opts.availableToday ?? true,
    photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null,
    isSaved: !!opts.saved,
  };
}

export function detail(v: VenueRow, saved: boolean) {
  const fmt = (m: number) => {
    const mm = ((m % 1440) + 1440) % 1440;
    const h = Math.floor(mm / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(mm % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return {
    ...summary(v, { saved }),
    address: v.address,
    shortAddress: `${v.address.split(',')[0].trim()}, ${v.area}`,
    openingHours: `Daily, ${fmt(v.open_min)} – ${fmt(v.close_min)}`,
    latitude: v.lat,
    longitude: v.lng,
    photos: (v.photos ?? []).map(photoUrl),
    amenities: v.amenities,
    rules: v.rules,
    about: v.about,
    sessionLengthMin: v.session_min,
    cancellationPolicy: v.cancellation_policy,
  };
}
