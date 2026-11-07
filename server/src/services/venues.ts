import { cacheDel, cacheGet, cacheIncr, cacheSet, hashGetAll, hashGetMany, hashWrite, l1Del, l1Get, l1Set, sharedReadable, singleflight } from '../cache';
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
export type SlotOut = { id: string; start: number; end: number; price: number; status: SlotStatus; holdId?: string };

// ── Availability: what is booked / held / blocked, per pitch per day ─────────────────────
/**
 * Stored in one Redis hash per day (`avail:<day>`), one field per pitch, plus `_full` when
 * the whole day was computed (then a missing field means "nothing booked").
 *
 * Correctness, not just speed:
 *  - Every API path that changes a booking recomputes that pitch-day from Postgres right
 *    after its commit and writes it (write-through), so the shared copy is current.
 *  - Writes carry the database's statement time; Redis keeps the newest, so a slow reader
 *    can never put an older picture back over a newer one.
 *  - Each copy remembers its database snapshot. When the app's realtime feed says "this day
 *    changed in transaction X", the server serves the cached copy only if it already
 *    includes X, else recomputes. No guesswork with timers.
 *  - Holds that run out are dropped at read time; a copy is never used after 3 minutes
 *    (covers anything changed outside the API, e.g. by hand in the database).
 * The database's exclusion constraint still makes double booking impossible regardless.
 */
type Taken = { s: number; e: number; kind: string; id: string | null; userId: string | null; until: number | null };
type DayEntry = { stamp: number; at: number; snap: string; taken: Taken[] };

const AVAIL_MAX_AGE_MS = 180_000;
const AVAIL_TTL_S = 600;
const L1_PITCH_MS = 2_000;
const L1_DAY_MS = 3_000;
const FULL = '_full';
const availKey = (day: string) => `avail:${day}`;

const encode = (e: DayEntry) => `${e.stamp}|${JSON.stringify({ at: e.at, snap: e.snap, taken: e.taken })}`;
function decode(raw: string | null | undefined): DayEntry | null {
  if (!raw) return null;
  const i = raw.indexOf('|');
  try {
    const body = JSON.parse(raw.slice(i + 1)) as Omit<DayEntry, 'stamp'>;
    return { stamp: Number(raw.slice(0, i)), at: body.at, snap: body.snap, taken: body.taken ?? [] };
  } catch {
    return null;
  }
}

/** Is committed transaction `xid` visible in snapshot "xmin:xmax:xip,…"? */
export function snapshotIncludes(snap: string, xid: bigint) {
  const [xmin, xmax, xip] = snap.split(':');
  if (xmin === undefined || xmax === undefined) return false;
  if (xid < BigInt(xmin)) return true;
  if (xid >= BigInt(xmax)) return false;
  return !(xip ?? '').split(',').filter(Boolean).some((x) => BigInt(x) === xid);
}

const usable = (e: DayEntry | null | undefined, since?: bigint): e is DayEntry =>
  !!e && Date.now() - e.at < AVAIL_MAX_AGE_MS && (since === undefined || snapshotIncludes(e.snap, since));

/** One query: bookings + blocks overlapping the day, for some pitches (or all), with the snapshot it saw. */
async function queryTaken(day: string, pitchIds: string[] | null, closeMin: number) {
  const row = await one<{ snap: string; stamp: string; rows: { p: string; s: string; e: string; kind: string; id: string | null; u: string | null; h: string | null }[] }>(
    `select pg_current_snapshot()::text snap,
            (extract(epoch from statement_timestamp()) * 1000000)::bigint::text stamp,
            coalesce((select json_agg(t) from (
              select pitch_id p, lower(during) s, upper(during) e,
                     case when status in ('held','pending') then 'held' else 'booked' end kind,
                     coalesce(order_id, id) id, user_id u, hold_expires_at h
                from bookings
               where ($1::uuid[] is null or pitch_id = any($1)) and during && tstzrange($2, $3)
                 and status in ('held','pending','confirmed','checked_in')
                 and not (status in ('held','pending') and hold_expires_at < now())
              union all
              select pitch_id, lower(during), upper(during), 'blocked', null, null, null
                from venue_blocks where ($1::uuid[] is null or pitch_id = any($1)) and during && tstzrange($2, $3)
            ) t), '[]'::json) rows`,
    [pitchIds, instant(day, 0), instant(day, closeMin + 60)],
  );
  const stamp = Number(row!.stamp);
  const at = Date.now();
  const byPitch = new Map<string, Taken[]>();
  for (const r of row!.rows) {
    const list = byPitch.get(r.p) ?? [];
    list.push({ s: Date.parse(r.s), e: Date.parse(r.e), kind: r.kind, id: r.id, userId: r.u, until: r.h ? Date.parse(r.h) : null });
    byPitch.set(r.p, list);
  }
  return { stamp, at, snap: row!.snap, byPitch };
}

async function computePitch(v: VenueRow, day: string): Promise<DayEntry> {
  const r = await queryTaken(day, [v.pitch_id], v.close_min);
  const entry: DayEntry = { stamp: r.stamp, at: r.at, snap: r.snap, taken: r.byPitch.get(v.pitch_id) ?? [] };
  await hashWrite(availKey(day), { [v.pitch_id]: encode(entry) }, AVAIL_TTL_S);
  l1Set(`${availKey(day)}:${v.pitch_id}`, entry, L1_PITCH_MS);
  l1Del(`${availKey(day)}:all`);
  return entry;
}

/** One pitch-day. `since` = a transaction the caller knows has committed; `bypass` = old apps' fresh=1. */
async function pitchTaken(v: VenueRow, day: string, opts: { since?: bigint; bypass?: boolean } = {}): Promise<Taken[]> {
  const key = availKey(day);
  const lk = `${key}:${v.pitch_id}`;
  if (!opts.bypass) {
    const local = l1Get<DayEntry>(lk);
    if (usable(local, opts.since)) return local.taken;
    const got = await hashGetMany(key, [v.pitch_id, FULL]);
    if (got) {
      const own = decode(got[0]);
      const full = decode(got[1]);
      // No field but a fresh full-day copy: nothing is booked on this pitch.
      const e = own ?? (full ? { ...full, taken: [] } : null);
      if (usable(e, opts.since)) {
        l1Set(lk, e, L1_PITCH_MS);
        return e.taken;
      }
    }
  }
  let e = await singleflight(`pitch:${lk}`, () => computePitch(v, day));
  // Joined a computation that started before `since` committed: run one more.
  if (opts.since !== undefined && !snapshotIncludes(e.snap, opts.since)) e = await computePitch(v, day);
  return e.taken;
}

/** Every pitch for one day (explore's "available" badge): one Redis read, or one query. */
async function dayTakenAll(day: string, rows: VenueRow[]): Promise<Map<string, Taken[]>> {
  const key = availKey(day);
  const lk = `${key}:all`;
  const local = l1Get<Map<string, Taken[]>>(lk);
  if (local) return local;
  return singleflight(`day:${lk}`, async () => {
    const all = await hashGetAll(key);
    const full = decode(all?.[FULL]);
    if (all && usable(full)) {
      const map = new Map<string, Taken[]>();
      for (const [f, raw] of Object.entries(all)) {
        if (f === FULL) continue;
        const e = decode(raw);
        if (e) map.set(f, e.taken);
      }
      l1Set(lk, map, L1_DAY_MS);
      return map;
    }
    const maxClose = rows.reduce((m, v) => Math.max(m, v.close_min), 0);
    const r = await queryTaken(day, null, maxClose);
    const fields: Record<string, string> = { [FULL]: encode({ stamp: r.stamp, at: r.at, snap: r.snap, taken: [] }) };
    for (const [p, taken] of r.byPitch) fields[p] = encode({ stamp: r.stamp, at: r.at, snap: r.snap, taken });
    await hashWrite(key, fields, AVAIL_TTL_S, r.stamp);
    l1Set(lk, r.byPitch, L1_DAY_MS);
    return r.byPitch;
  });
}

/**
 * Call after any committed change to bookings (holds, payments, cancellations, check-ins).
 * Recomputes those pitch-days so the shared copy is current before anyone asks again.
 */
export async function refreshDays(pairs: { venueId: string; day: string }[]) {
  const seen = new Set<string>();
  await Promise.all(
    pairs.map(async ({ venueId, day }) => {
      const k = `${venueId}|${day}`;
      if (seen.has(k)) return;
      seen.add(k);
      const v = (await loadCatalog().catch(() => null))?.byId.get(venueId) ?? (await getVenueRowExact(venueId).catch(() => null));
      if (!v) return;
      l1Del(`${availKey(day)}:${v.pitch_id}`, `${availKey(day)}:all`);
      try {
        await computePitch(v, day);
      } catch {
        // Couldn't recompute: drop the whole day so nobody is served the old picture.
        await cacheDel(availKey(day));
      }
    }),
  );
}
export const invalidateDay = (venueId: string, day: string) => refreshDays([{ venueId, day }]);

function inBookingWindow(day: string) {
  const today = dhakaToday();
  return day >= today && day <= addDays(today, config.BOOKING_HORIZON_DAYS);
}

/** Pure: the day's sessions with their status, from the venue and what is taken. */
function buildSlots(v: VenueRow, day: string, taken: Taken[], viewerId?: string): SlotOut[] {
  const today = dhakaToday();
  const hourly = hourlyFor(rules(v), day);
  const nowMin = minutesNowInDhaka();
  const now = Date.now();
  return generateSessions({ openMin: v.open_min, closeMin: v.close_min, lengthMin: v.session_min, breakMin: v.break_min })
    .filter(({ start }) => day !== today || start > nowMin)
    .map(({ start, end }) => {
      const s = instant(day, start).getTime();
      const e = instant(day, end).getTime();
      // A hold that has run out since the copy was made is free again.
      const clash = taken.find((t) => t.s < e && t.e > s && !(t.kind === 'held' && t.until !== null && t.until < now));
      const base = { id: `${v.id}:${day}:${start}`, start, end, price: sessionPrice(hourly, v.session_min) };
      if (!clash) return { ...base, status: 'available' as const };
      if (clash.kind === 'held' && viewerId && clash.userId === viewerId) return { ...base, status: 'mine' as const, holdId: clash.id! };
      return { ...base, status: clash.kind as SlotStatus };
    });
}

/**
 * Slots for one day, computed from the schedule (no pre-generated slot rows) and overlaid
 * with active bookings and owner blocks (see Availability above for how that is cached).
 */
export async function daySlots(v: VenueRow, day: string, viewerId?: string, opts: { since?: bigint; bypass?: boolean } = {}): Promise<SlotOut[]> {
  if (!inBookingWindow(day)) return [];
  return buildSlots(v, day, await pitchTaken(v, day, opts), viewerId);
}

/** For explore: is anything still bookable on `day`, for each venue? One read for all of them. */
export async function availabilityFor(rows: VenueRow[], day: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!inBookingWindow(day)) {
    rows.forEach((v) => out.set(v.id, false));
    return out;
  }
  const taken = await dayTakenAll(day, rows);
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
