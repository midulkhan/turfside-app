import { cacheGet, cacheIncr, cacheSet, sharedReadable, singleflight } from '../cache';
import { config } from '../config';
import { one, q } from '../db';
import { ApiError } from '../errors';
import { addDays, dhakaToday, hourlyFor, instant, minutesNowInDhaka, priceFor, sessionsFor, type CustomSlot, type PriceBand, type PriceRules, type SessionSetRow, type SlotRules } from '../lib/time';

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
  /** Owner dashboard settings (migration 020). Missing on rows cached before it: treated as the defaults. */
  slot_mode?: string | null;
  custom_slots?: CustomSlot[] | null;
  bands?: PriceBand[] | null;
  /** Migration 021: the owner paused new bookings (missing on older cached rows = not paused). */
  booking_paused?: boolean | null;
  short_code?: string | null;
  ref_no?: number | null;
  slot_sets?: SessionSetRow[] | null;
  booking_notice?: string | null;
  photos: string[] | null;
  pitch_id: string;
};

const VENUE_SELECT = `
  select v.id, v.name, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.floodlit, v.amenities, v.rules, v.about,
         v.cancellation_policy, v.rating, v.review_count,
         s.open_min, s.close_min, s.session_min, s.break_min,
         p.standard_hourly, p.weekday_hourly, p.special_dates,
         s.slot_mode, s.custom_slots, s.slot_sets, p.bands, v.booking_paused, v.booking_notice, v.short_code, v.ref_no,
         (select array_agg(url order by position) from venue_photos ph where ph.venue_id = v.id) as photos,
         (select id from pitches pi where pi.venue_id = v.id order by name limit 1) as pitch_id
  from venues v
  join venue_schedule s on s.venue_id = v.id
  join venue_pricing p on p.venue_id = v.id
  where v.status = 'published'`;

export const photoUrl = (u: string) => (u.startsWith('/') ? `${config.PUBLIC_URL}${u}` : u);
export const rules = (v: VenueRow): PriceRules & { bands: PriceBand[] } => ({
  standardHourly: v.standard_hourly,
  weekdayHourly: v.weekday_hourly,
  specialDates: v.special_dates,
  bands: v.bands ?? [],
});
/** The venue's sessions for any day (fixed lengths or the owner's custom list). */
export const slotRules = (v: VenueRow): SlotRules => ({
  openMin: v.open_min,
  closeMin: v.close_min,
  lengthMin: v.session_min,
  breakMin: v.break_min,
  mode: v.slot_mode,
  custom: v.custom_slots,
  sets: v.slot_sets,
});
/** Lowest price per hour on `day` (poisha). Kept for `hourlyFrom`, which older app builds show. */
export function hourlyFromFor(v: VenueRow, day: string) {
  const r = rules(v);
  if (!r.bands.length && v.slot_mode !== 'custom') return hourlyFor(r, day);
  const per = sessionsFor(slotRules(v), day).map((s) => Math.round((priceFor(r, day, s) * 60) / Math.max(1, s.end - s.start)));
  return per.length ? Math.min(...per) : hourlyFor(r, day);
}

export const STARTING_DAYS = 7;

/** Lowest per-hour price over the next 7 days, for the legacy `hourlyFrom` field. */
function hourlyFrom7(v: VenueRow) {
  const today = dhakaToday();
  return Math.min(...Array.from({ length: STARTING_DAYS }, (_, i) => hourlyFromFor(v, addDays(today, i))));
}

/**
 * "Starting at": the cheapest thing a player can actually book in the next 7 days (from now; sessions
 * that have already started today don't count), so it doesn't change from one day to the next.
 *  - Custom sessions (owner prices each session): the cheapest session's own price and its length,
 *    e.g. ৳2,000 for a 2-hour session. Never an hourly figure nobody can pay.
 *  - Same-length sessions: the lowest price per hour.
 * Amounts in poisha.
 */
export function startingPrice(v: VenueRow, today = dhakaToday(), nowMin = minutesNowInDhaka()):
  | { per: 'session'; amount: number; minutes: number }
  | { per: 'hour'; amount: number } {
  const r = rules(v);
  const sr = slotRules(v);
  const custom = v.slot_mode === 'custom';
  let best: { amount: number; minutes: number; hourly: number } | null = null;
  for (let i = 0; i < STARTING_DAYS; i++) {
    const day = addDays(today, i);
    for (const s of sessionsFor(sr, day)) {
      if (i === 0 && s.start < nowMin) continue;
      const minutes = Math.max(1, s.end - s.start);
      const amount = priceFor(r, day, s);
      const hourly = Math.round((amount * 60) / minutes);
      const better = custom
        ? !best || amount < best.amount || (amount === best.amount && minutes > best.minutes)
        : !best || hourly < best.hourly;
      if (better) best = { amount, minutes, hourly };
    }
  }
  if (!best) return { per: 'hour', amount: hourlyFor(r, today) };
  return custom ? { per: 'session', amount: best.amount, minutes: best.minutes } : { per: 'hour', amount: best.hourly };
}

// ── Catalog: every published venue, the source for explore, search and turf pages ──────────
/**
 * One shared copy in Redis (`venues:all`, tagged with `catalog:ver`), one parsed copy per
 * process. A process re-checks the tiny version key at most once a minute; owner edits bump
 * it, so every process picks up a change within a minute and the editing process instantly.
 * Prices that money depends on are never read from here: holds read the venue from Postgres.
 */
type Catalog = { ver: string; rows: VenueRow[]; byId: Map<string, VenueRow>; checkedAt: number; builtAt: number };
let catalog: Catalog | null = null;
const CATALOG_CHECK_MS = 60_000;
const CATALOG_TTL_S = 15 * 60;

const build = (ver: string, rows: VenueRow[]): Catalog => ({
  ver,
  rows,
  byId: new Map(rows.map((r) => [r.id, r])),
  checkedAt: Date.now(),
  builtAt: Date.now(),
});

async function loadCatalog(): Promise<Catalog> {
  const c = catalog;
  if (c && Date.now() - c.checkedAt < CATALOG_CHECK_MS) return c;
  return singleflight('catalog', async () => {
    if (!sharedReadable()) return (catalog = build('local', await q<VenueRow>(VENUE_SELECT)));
    const ver = String((await cacheGet<number>('catalog:ver')) ?? 0);
    const cur = catalog;
    if (cur && cur.ver === ver && Date.now() - cur.builtAt < CATALOG_TTL_S * 1000) {
      cur.checkedAt = Date.now();
      return cur;
    }
    const shared = await cacheGet<{ ver: string; rows: VenueRow[] }>('venues:all');
    if (shared && shared.ver === ver) return (catalog = build(ver, shared.rows));
    const rows = await q<VenueRow>(VENUE_SELECT);
    await cacheSet('venues:all', { ver, rows }, CATALOG_TTL_S);
    return (catalog = build(ver, rows));
  });
}

export const allVenueRows = async () => (await loadCatalog()).rows;

/** For display (turf page, cart, bookings). Throws not_found for unlisted turfs. */
export async function getVenueRow(id: string) {
  const v = (await loadCatalog()).byId.get(id);
  if (!v) throw new ApiError('not_found', 'This turf is no longer listed.');
  return v;
}

/** Straight from Postgres: for anything that sets a price or accepts a booking. */
export async function getVenueRowExact(id: string) {
  const v = await one<VenueRow>(`${VENUE_SELECT} and v.id = $1`, [id]);
  if (!v) throw new ApiError('not_found', 'This turf is no longer listed.');
  return v;
}

/** Owner side: any of the owner's own turfs, including drafts (never suspended ones). */
export async function getOwnedVenueRow(ownerId: string, id: string) {
  const v = await one<VenueRow & { status: string }>(
    `${VENUE_SELECT.replace("where v.status = 'published'", "where v.status <> 'suspended'").replace('select v.id,', 'select v.status, v.id,')} and v.id = $1 and v.owner_id = $2`,
    [id, ownerId],
  );
  if (!v) throw new ApiError('not_found', 'Turf not found.');
  return v;
}

/** After any venue edit (details, schedule, prices, photos, listing). */
export async function invalidateVenue(_id?: string) {
  catalog = null;
  await cacheIncr('catalog:ver');
}

/**
 * held = someone is checking out right now (10-minute hold or bKash in progress);
 * mine = the signed-in player's own hold, which they can resume (holdId).
 */
export type SlotStatus = 'available' | 'booked' | 'blocked' | 'held' | 'mine';
/** `squad`: a booked slot whose organiser is recruiting: tapping it opens the squad. */
export type SlotSquad = { id: string; spotsLeft: number; host?: boolean; opponent?: boolean };
export type SlotOut = { id: string; start: number; end: number; price: number; status: SlotStatus; holdId?: string; squad?: SlotSquad };

// ── Availability: what is booked / held / blocked, per pitch per day ─────────────────────
/**
 * Always read live from Postgres: no Redis copy, no in-memory copy. Every slot request runs
 * one indexed query, so a booking, hold, payment or cancellation is visible to the very next
 * request, on every server process. The exclusion constraint still makes double booking
 * impossible regardless.
 */
type Taken = { s: number; e: number; kind: string; id: string | null; userId: string | null; until: number | null; sq?: { id: string; left: number; host: string; type: string } | null };

/** Is committed transaction `xid` visible in snapshot "xmin:xmax:xip,…"? (kept for tests/tools) */
export function snapshotIncludes(snap: string, xid: bigint) {
  const [xmin, xmax, xip] = snap.split(':');
  if (xmin === undefined || xmax === undefined) return false;
  if (xid < BigInt(xmin)) return true;
  if (xid >= BigInt(xmax)) return false;
  return !(xip ?? '').split(',').filter(Boolean).some((x) => BigInt(x) === xid);
}

/** One query: live bookings + blocks overlapping the day, for some pitches (or all). */
async function queryTaken(day: string, pitchIds: string[] | null, closeMin: number) {
  const { HOLDING } = await import('./matches'); // lazy: matches imports this module
  type Sq = { id: string; left: number; host: string; type: string } | null;
  const row = await one<{ rows: { p: string; s: string; e: string; kind: string; id: string | null; u: string | null; h: string | null; sq: Sq }[] }>(
    `select coalesce((select json_agg(t) from (
              select bk.pitch_id p, lower(bk.during) s, upper(bk.during) e,
                     case when bk.status in ('held','pending') then 'held' else 'booked' end kind,
                     coalesce(bk.order_id, bk.id) id, bk.user_id u, bk.hold_expires_at h,
                     -- A squad recruiting on this booking: spots still free to request.
                     (select json_build_object('id', r.id, 'host', r.user_id, 'type', r.type, 'left', greatest(0, r.spots_total
                              - (select coalesce(sum(m.spots), 0) from player_request_members m where m.request_id = r.id and m.status = 'paid')
                              - (select coalesce(sum(m.spots), 0) from player_request_members m where m.request_id = r.id and ${HOLDING})))
                        from player_requests r where r.booking_id = bk.id and r.status = 'open' limit 1) sq
                from bookings bk
               where ($1::uuid[] is null or bk.pitch_id = any($1)) and bk.during && tstzrange($2, $3)
                 and bk.status in ('held','pending','confirmed','checked_in')
                 and not (bk.status in ('held','pending') and bk.hold_expires_at < now())
              union all
              select pitch_id, lower(during), upper(during), 'blocked', null, null, null, null
                from venue_blocks where ($1::uuid[] is null or pitch_id = any($1)) and during && tstzrange($2, $3)
            ) t), '[]'::json) rows`,
    [pitchIds, instant(day, 0), instant(day, closeMin + 60)],
  );
  const byPitch = new Map<string, Taken[]>();
  for (const r of row!.rows) {
    const list = byPitch.get(r.p) ?? [];
    list.push({ s: Date.parse(r.s), e: Date.parse(r.e), kind: r.kind, id: r.id, userId: r.u, until: r.h ? Date.parse(r.h) : null, sq: r.sq });
    byPitch.set(r.p, list);
  }
  // A squad belongs to a whole ticket: back-to-back slots of the same order share it.
  for (const list of byPitch.values()) {
    const booked = list.filter((t) => t.kind === 'booked' && t.id).sort((a, b) => a.s - b.s);
    for (let i = 0; i < booked.length; i++) {
      let j = i;
      while (j + 1 < booked.length && booked[j + 1]!.id === booked[i]!.id && booked[j + 1]!.s === booked[j]!.e) j++;
      const sq = booked.slice(i, j + 1).find((t) => t.sq)?.sq;
      if (sq) for (let k = i; k <= j; k++) booked[k]!.sq = sq;
      i = j;
    }
  }
  return byPitch;
}

const pitchTaken = async (v: VenueRow, day: string) => (await queryTaken(day, [v.pitch_id], v.close_min)).get(v.pitch_id) ?? [];

/**
 * Kept so existing call sites (after holds, payments, cancellations) still compile. There is
 * no copy to refresh any more; the realtime trigger on `slot_updates` tells apps to reload.
 */
export async function refreshDays(_pairs: { venueId: string; day: string }[]) {}
export const invalidateDay = (venueId: string, day: string) => refreshDays([{ venueId, day }]);

function inBookingWindow(day: string) {
  const today = dhakaToday();
  return day >= today && day <= addDays(today, config.BOOKING_HORIZON_DAYS);
}

/** Pure: the day's sessions with their status, from the venue and what is taken. */
function buildSlots(v: VenueRow, day: string, taken: Taken[], viewerId?: string): SlotOut[] {
  const today = dhakaToday();
  const prices = rules(v);
  const nowMin = minutesNowInDhaka();
  const now = Date.now();
  return sessionsFor(slotRules(v), day)
    .filter(({ start }) => day !== today || start > nowMin)
    .map((session) => {
      const { start, end } = session;
      const s = instant(day, start).getTime();
      const e = instant(day, end).getTime();
      // A hold that has run out since the copy was made is free again.
      const clash = taken.find((t) => t.s < e && t.e > s && !(t.kind === 'held' && t.until !== null && t.until < now));
      const base = { id: `${v.id}:${day}:${start}`, start, end, price: priceFor(prices, day, session) };
      // Paused by the owner: nothing new can be booked (older apps show these as unavailable too).
      // A checkout already in progress can still finish.
      if (v.booking_paused && !clash) return { ...base, status: 'blocked' as const };
      if (!clash) return { ...base, status: 'available' as const };
      if (clash.kind === 'held' && viewerId && clash.userId === viewerId) return { ...base, status: 'mine' as const, holdId: clash.id! };
      if (clash.kind === 'booked' && clash.sq && clash.sq.left > 0)
        return {
          ...base,
          status: 'booked' as const,
          squad: {
            id: clash.sq.id,
            spotsLeft: clash.sq.left,
            ...(clash.sq.type === 'opponent' ? { opponent: true } : {}),
            ...(viewerId && clash.sq.host === viewerId ? { host: true } : {}),
          },
        };
      return { ...base, status: clash.kind as SlotStatus };
    });
}

/**
 * Slots for one day, computed from the schedule (no pre-generated slot rows) and overlaid
 * with active bookings and owner blocks (see Availability above for how that is cached).
 */
export async function daySlots(v: VenueRow, day: string, viewerId?: string): Promise<SlotOut[]> {
  if (!inBookingWindow(day)) return [];
  return buildSlots(v, day, await pitchTaken(v, day), viewerId);
}

/** For explore: is anything still bookable on `day`, for each venue? One read for all of them. */
export async function availabilityFor(rows: VenueRow[], day: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!inBookingWindow(day)) {
    rows.forEach((v) => out.set(v.id, false));
    return out;
  }
  const maxClose = rows.reduce((m, v) => Math.max(m, v.close_min), 0);
  const taken = await queryTaken(day, null, maxClose);
  for (const v of rows) out.set(v.id, buildSlots(v, day, taken.get(v.pitch_id) ?? []).some((s) => s.status === 'available'));
  return out;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function summary(v: VenueRow, opts: { lat?: number; lng?: number; saved?: boolean; availableToday?: boolean }) {
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
    // Older app builds show this as "৳… / hour"; it now covers the next 7 days like startingPrice.
    hourlyFrom: hourlyFrom7(v),
    startingPrice: startingPrice(v),
    availableToday: opts.availableToday ?? true,
    photo: v.photos?.[0] ? photoUrl(v.photos[0]) : null,
    isSaved: !!opts.saved,
    bookingPaused: !!v.booking_paused,
  };
}

/** "TS-5356", the turf's public reference number. */
export const refLabel = (n: number | null | undefined) => (n ? `TS-${n}` : null);
/** turfsides.com/FDJV346, the turf's share link (opens the app when it's installed). */
export const shareUrl = (code: string | null | undefined) => (code ? `${config.SITE_URL.replace(/\/+$/, '')}/${code}` : null);
export const SHORT_CODE = /^[A-HJ-NP-Z2-9]{7}$/;
const turfIds = (v: { short_code?: string | null; ref_no?: number | null }) => ({
  ref: refLabel(v.ref_no),
  shortCode: v.short_code ?? null,
  shareUrl: shareUrl(v.short_code),
});

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
    ...turfIds(v),
    /** Shown on the turf page while the owner has paused bookings. */
    bookingNotice: v.booking_paused ? v.booking_notice || 'This turf is not taking new bookings right now.' : null,
  };
}
