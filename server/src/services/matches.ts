import type { PoolClient } from 'pg';

import { one, q, tx } from '../db';
import { ApiError } from '../errors';
import { publicUrl, storageEnabled } from '../lib/storage';
import { instant } from '../lib/time';

import { getVenueRow, photoUrl } from './venues';

/**
 * Find players.
 *
 * A match = open spots on a booking the organiser has already paid for (no booking, no post),
 * so every game is real, priced and placed. Players ask to join; the organiser accepts; the
 * accepted player has a short window to pay their share through bKash; paying puts them in the
 * squad. The share is fixed by the server (booking total / squad size, rounded up to the taka),
 * so nobody can profit from strangers and the price is the same for everyone.
 */

export type Level = 'casual' | 'regular' | 'competitive';
export type Position = 'any' | 'goalkeeper' | 'defender' | 'midfielder' | 'forward';
export type MyStatus = 'owner' | 'none' | 'pending' | 'accepted' | 'paid' | 'declined' | 'withdrawn' | 'expired';

const CLOSE_BEFORE_MIN = 30; // requests and payments stop this long before kick-off
const PAY_WINDOW_MIN = 5; // an accepted player has this long to pay (never past CLOSE_BEFORE_MIN)
/** How long a bKash checkout started inside the pay window keeps the spots held. */
const CHECKOUT_GRACE_MIN = 15;

/**
 * SQL: member row `m` is holding spots right now. Accepted and inside the pay window, or
 * accepted with a bKash checkout started in time and still open, so nobody else is let into
 * spots someone is paying for this second.
 */
export const HOLDING = `(m.status = 'accepted' and (m.pay_by > now() or exists (
  select 1 from payments p where p.match_id = m.request_id and p.user_id = m.user_id and p.kind = 'share'
     and p.status in ('initiated', 'pending') and p.created_at <= m.pay_by and p.created_at > now() - interval '${CHECKOUT_GRACE_MIN} minutes')))`;
export const PAGE_SIZE = 10;

const avatar = (key: string | null) => (key && storageEnabled() ? publicUrl(key) : null);
/** "5-a-side" → 10 players. */
export const squadSize = (format: string) => {
  const m = /^(\d+)-a-side$/.exec(format);
  return m ? Math.min(Number(m[1]) * 2, 30) : 10;
};
const fairShare = (total: number, players: number) => Math.ceil(total / players / 100) * 100;

type Row = {
  id: string;
  user_id: string;
  title: string;
  level: Level;
  format: string;
  players_total: number;
  spots_total: number;
  share: number;
  status: string;
  booking_id: string;
  venue_id: string;
  day: string;
  start_min: number;
  end_min: number;
  paid: number;
  reserved: number;
  reserved_until: Date | null;
  my_status: string | null;
  my_pay_by: Date | null;
  my_spots: number | null;
  faces: { name: string; avatar_key: string | null }[];
  organiser_name: string;
  organiser_avatar: string | null;
};

/** Shared select: a match with its live counts and the viewer's own status ($1 = viewer id or null). */
const SELECT = `
  select r.id, r.user_id, r.title, r.level, r.format, r.players_total, r.spots_total, r.share, r.status, r.booking_id,
         b.venue_id, b.day::text, b.start_min, b.end_min,
         (select coalesce(sum(m.spots), 0) from player_request_members m where m.request_id = r.id and m.status = 'paid')::int paid,
         (select coalesce(sum(m.spots), 0) from player_request_members m where m.request_id = r.id and ${HOLDING})::int reserved,
         (select min(m.pay_by) from player_request_members m where m.request_id = r.id and m.status = 'accepted' and m.pay_by > now()) reserved_until,
         me.status my_status, me.pay_by my_pay_by, me.spots my_spots,
         coalesce((select json_agg(x) from (
           select u.name, u.avatar_key from player_request_members m join users u on u.id = m.user_id
            where m.request_id = r.id and m.status = 'paid' order by m.paid_at limit 2) x), '[]'::json) faces,
         o.name organiser_name, o.avatar_key organiser_avatar
    from player_requests r
    join bookings b on b.id = r.booking_id
    join users o on o.id = r.user_id
    left join player_request_members me on me.request_id = r.id and me.user_id = $1`;

async function shape(r: Row, viewerId: string | null) {
  const v = await getVenueRow(r.venue_id).catch(() => null);
  const spotsLeft = Math.max(0, r.spots_total - r.paid - r.reserved);
  const playersIn = r.players_total - r.spots_total + r.paid;
  const faces = [{ name: r.organiser_name, avatar: avatar(r.organiser_avatar) }, ...r.faces.map((f) => ({ name: f.name, avatar: avatar(f.avatar_key) }))];
  let my: MyStatus = viewerId && r.user_id === viewerId ? 'owner' : ((r.my_status as MyStatus | null) ?? 'none');
  // An accepted player who let the payment window pass is no longer holding a spot.
  if (my === 'accepted' && r.my_pay_by && new Date(r.my_pay_by) < new Date()) my = 'expired';
  return {
    id: r.id,
    title: r.title,
    level: r.level,
    format: r.format,
    status: r.status,
    venue: {
      id: r.venue_id,
      name: v?.name ?? 'Turf',
      area: v?.area ?? '',
      city: v?.city ?? '',
      photo: v?.photos?.[0] ? photoUrl(v.photos[0]) : null,
      latitude: v?.lat ?? null,
      longitude: v?.lng ?? null,
    },
    day: r.day,
    start: r.start_min,
    end: r.end_min,
    playersTotal: r.players_total,
    playersIn,
    openSpots: r.spots_total - r.paid,
    spotsLeft,
    share: r.share,
    faces,
    // People in the squad beyond the faces shown (the organiser's own group counts).
    moreCount: Math.max(0, playersIn - faces.length),
    my,
    /** How many spots the viewer asked for / holds / paid for. */
    mySpots: r.my_spots ?? 1,
    payBy: my === 'accepted' && r.my_pay_by ? new Date(r.my_pay_by).getTime() : null,
    /** When the next held spot is released if unpaid: the app refreshes then. */
    reservedUntil: r.reserved_until ? new Date(r.reserved_until).getTime() : null,
  };
}
export type MatchOut = Awaited<ReturnType<typeof shape>>;

const kickoff = (r: { day: string; start_min: number }) => instant(r.day, r.start_min).getTime();

async function notify(c: { query: (s: string, p: unknown[]) => Promise<unknown> }, userId: string, title: string, body: string, data: Record<string, unknown>) {
  await c.query("insert into notifications (user_id, kind, title, body, data) values ($1, 'match', $2, $3, $4)", [userId, title, body, JSON.stringify(data)]);
}

const timeLabel = (day: string, startMin: number) => {
  const d = instant(day, startMin);
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
};
const taka = (poisha: number) => `৳${Math.round(poisha / 100).toLocaleString('en-IN')}`;

// ── Feed ───────────────────────────────────────────────────────────────────

/** Open games anyone can join, soonest first, 10 at a time. `nearby`: within 10 km of lat/lng. */
export async function feed(
  viewerId: string | null,
  p: { lat?: number; lng?: number; nearby?: boolean; day?: string; cursor?: number; limit?: number },
) {
  const limit = Math.min(p.limit ?? PAGE_SIZE, 20);
  const offset = p.cursor ?? 0;
  const near = p.nearby && p.lat !== undefined && p.lng !== undefined;
  const rows = await q<Row>(
    `select * from (${SELECT}
       join venues v on v.id = b.venue_id
      where r.status = 'open' and b.status in ('confirmed', 'checked_in')
        and lower(b.during) > now() + make_interval(mins => ${CLOSE_BEFORE_MIN})
        and ($2::date is null or b.day = $2)
        and (not $3::boolean or 6371 * acos(least(1, cos(radians($4)) * cos(radians(v.lat)) * cos(radians(v.lng) - radians($5)) + sin(radians($4)) * sin(radians(v.lat)))) <= 10)
     ) m
     where (m.spots_total - m.paid - m.reserved) > 0 or m.my_status is not null or m.user_id = $1
     order by m.day, m.start_min, m.id
     offset $6 limit $7`,
    [viewerId, p.day ?? null, !!near, p.lat ?? 0, p.lng ?? 0, offset, limit + 1],
  );
  const page = rows.slice(0, limit);
  return {
    items: await Promise.all(page.map((r) => shape(r, viewerId))),
    nextCursor: rows.length > limit ? offset + limit : null,
  };
}

async function loadMatch(id: string, viewerId: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'Match not found.');
  const r = await one<Row>(`${SELECT} where r.id = $2`, [viewerId, id]);
  if (!r || r.status === 'cancelled') throw new ApiError('not_found', 'This match is no longer available.');
  return r;
}

export async function getMatch(viewerId: string | null, id: string) {
  const r = await loadMatch(id, viewerId);
  const m = await shape(r, viewerId);
  // A paid player gets the organiser's own entry pass (same code and QR), so they can get in too.
  if (m.my !== 'paid') return m;
  const { getBooking } = await import('./bookings'); // lazy: bookings imports this module
  const t = await getBooking(r.user_id, r.booking_id).catch(() => null);
  // …and the organiser's number (they agreed when opening spots). Never other players' numbers.
  const host = await one<{ name: string; phone: string }>(
    `select u.name, coalesce(r.contact_phone, u.phone) phone from player_requests r join users u on u.id = r.user_id where r.id = $1 and r.phone_consent_at is not null`,
    [id],
  );
  return { ...m, pass: t ? { code: t.code, passToken: t.passToken } : null, ...(host ? { host: { name: host.name, phone: host.phone } } : {}) };
}

/** Spots paid for or held right now (inside a transaction that has locked the match row). */
async function spotsTaken(c: PoolClient, id: string) {
  const res = await c.query<{ n: number }>(
    `select coalesce(sum(m.spots), 0)::int n from player_request_members m where m.request_id = $1 and (m.status = 'paid' or ${HOLDING})`,
    [id],
  );
  return res.rows[0].n;
}

/**
 * The organiser's page: your upcoming matches, and your upcoming paid bookings that could
 * still take players (no match yet, more than an hour to kick-off).
 */
export async function mine(userId: string) {
  const rows = await q<Row>(
    `${SELECT} where r.user_id = $1 and r.status <> 'cancelled' and b.status in ('confirmed', 'checked_in') and upper(b.during) > now()
     order by b.day, b.start_min`,
    [userId],
  );
  const open = await q<{ id: string; venue_id: string; day: string; start_min: number; end_min: number; total: number }>(
    `select b.id, b.venue_id, b.day::text, b.start_min, b.end_min, b.total
       from bookings b
      where b.user_id = $1 and b.status = 'confirmed' and lower(b.during) > now() + interval '60 minutes'
        and not exists (select 1 from player_requests r where r.booking_id = b.id and r.status <> 'cancelled')
      order by b.day, b.start_min limit 20`,
    [userId],
  );
  const bookings = await Promise.all(
    open.map(async (b) => {
      const v = await getVenueRow(b.venue_id).catch(() => null);
      return {
        id: b.id,
        venue: { id: b.venue_id, name: v?.name ?? 'Turf', area: v?.area ?? '', photo: v?.photos?.[0] ? photoUrl(v.photos[0]) : null },
        format: v?.formats?.[0] ?? '5-a-side',
        day: b.day,
        start: b.start_min,
        end: b.end_min,
        amountPaid: b.total,
      };
    }),
  );
  return { matches: await Promise.all(rows.map((r) => shape(r, userId))), bookings };
}

/** Squads you've paid into (newest first): they sit with your bookings in the app. */
export async function joined(userId: string) {
  const rows = await q<Row>(`${SELECT} where me.status = 'paid' order by b.day desc, b.start_min desc limit 50`, [userId]);
  return Promise.all(rows.map((r) => shape(r, userId)));
}

// ── Organiser ──────────────────────────────────────────────────────────────

/** Open spots on one of your confirmed bookings. Idempotent: a booking has one live match. */
export async function createMatch(userId: string, input: { bookingId: string; title?: string; level: Level; openSpots: number; sharePhone?: true; contactPhone?: string }) {
  const b = await one<{ id: string; venue_id: string; day: string; start_min: number; total: number; status: string }>(
    'select id, venue_id, day::text, start_min, total, status from bookings where id = $1 and user_id = $2',
    [input.bookingId, userId],
  );
  if (!b || !['confirmed', 'checked_in'].includes(b.status)) throw new ApiError('not_found', 'Booking not found.');
  if (kickoff(b) - Date.now() < 60 * 60_000) throw new ApiError('forbidden', 'Players can be found up to an hour before kick-off.');
  const existing = await one<{ id: string }>("select id from player_requests where booking_id = $1 and status <> 'cancelled'", [b.id]);
  if (existing) return getMatch(userId, existing.id);

  const v = await getVenueRow(b.venue_id);
  const format = v.formats[0] ?? '5-a-side';
  const players = squadSize(format);
  if (input.openSpots < 1 || input.openSpots >= players) throw new ApiError('invalid', `Open between 1 and ${players - 1} spots.`);
  const hour = Math.floor(b.start_min / 60) % 24;
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';
  const title = (input.title?.trim() || `${part} ${format}`).slice(0, 60);
  const created = await one<{ id: string }>(
    `insert into player_requests (booking_id, user_id, spots_total, spots_filled, share, status, title, level, format, players_total, phone_consent_at, contact_phone)
     values ($1,$2,$3,0,$4,'open',$5,$6,$7,$8, now(), $9)
     on conflict (booking_id) where status <> 'cancelled' do update set updated_at = now(), phone_consent_at = coalesce(player_requests.phone_consent_at, now())
     returning id`,
    // A different number for this squad (10 national digits, already validated) — stored like account numbers.
    [b.id, userId, input.openSpots, fairShare(b.total, players), title, input.level, format, players, input.contactPhone ? `+880${input.contactPhone}` : null],
  );
  return getMatch(userId, created!.id);
}

async function ownMatch(userId: string, id: string) {
  const r = await loadMatch(id, userId);
  if (r.user_id !== userId) throw new ApiError('not_found', 'Match not found.');
  return r;
}

/** The organiser's view: the match plus everyone who asked and everyone in. */
export async function manage(userId: string, id: string) {
  const r = await ownMatch(userId, id);
  const people = await q<{ user_id: string; name: string; avatar_key: string | null; position: string | null; level: string | null; status: string; pay_by: Date | null; holding: boolean; spots: number; games: number; phone: string | null }>(
    `select m.user_id, u.name, u.avatar_key, m.position, m.level, m.status, m.pay_by, ${HOLDING} holding, m.spots,
            -- The organiser sees a player's number only once they've paid (and agreed when asking).
            case when m.status = 'paid' and m.phone_consent_at is not null then u.phone end phone,
            ((select count(*) from bookings x where x.user_id = m.user_id and x.status in ('checked_in','completed','confirmed') and x.day < (now() at time zone 'Asia/Dhaka')::date)
             + (select count(*) from player_request_members y join player_requests z on z.id = y.request_id join bookings w on w.id = z.booking_id
                 where y.user_id = m.user_id and y.status = 'paid' and w.day < (now() at time zone 'Asia/Dhaka')::date))::int games
       from player_request_members m join users u on u.id = m.user_id
      where m.request_id = $1 and m.status in ('pending', 'accepted', 'paid')
      order by m.created_at`,
    [id],
  );
  const person = (x: (typeof people)[number]) => ({
    userId: x.user_id,
    name: x.name,
    avatar: avatar(x.avatar_key),
    position: (x.position ?? 'any') as Position,
    level: (x.level ?? 'casual') as Level,
    games: x.games,
    spots: x.spots,
  });
  const b = await one<{ code: string }>('select code from bookings where id = $1', [r.booking_id]);
  return {
    ...(await shape(r, userId)),
    booking: { id: r.booking_id, code: b?.code ?? '' },
    requests: people.filter((x) => x.status === 'pending').map(person),
    squad: people
      .filter((x) => x.status === 'paid' || x.holding)
      .map((x) => ({
        ...person(x),
        paid: x.status === 'paid',
        payBy: x.status === 'accepted' && x.pay_by ? new Date(x.pay_by).getTime() : null,
        ...(x.phone ? { phone: x.phone } : {}),
      })),
  };
}

export async function updateMatch(userId: string, id: string, input: { title?: string; paused?: boolean }) {
  const r = await ownMatch(userId, id);
  if (input.title !== undefined) await q('update player_requests set title = $2, updated_at = now() where id = $1', [id, input.title.trim().slice(0, 60)]);
  if (input.paused !== undefined && (r.status === 'open' || r.status === 'paused'))
    await q('update player_requests set status = $2, updated_at = now() where id = $1', [id, input.paused ? 'paused' : 'open']);
  return manage(userId, id);
}

/** Accept: the player's spot is held for them until they pay (or the window closes). */
export async function decide(userId: string, id: string, memberId: string, accept: boolean) {
  await tx(async (c) => {
    const r = (
      await c.query<{ user_id: string; spots_total: number; status: string; day: string; start_min: number; share: number; venue_id: string }>(
        `select r.user_id, r.spots_total, r.status, b.day::text, b.start_min, r.share, b.venue_id
           from player_requests r join bookings b on b.id = r.booking_id where r.id = $1 for update of r`,
        [id],
      )
    ).rows[0];
    if (!r || r.user_id !== userId || r.status === 'cancelled') throw new ApiError('not_found', 'Match not found.');
    const m = (await c.query<{ status: string; spots: number }>('select status, spots from player_request_members where request_id = $1 and user_id = $2 for update', [id, memberId])).rows[0];
    if (!m || m.status !== 'pending') throw new ApiError('conflict', 'This request was already answered or withdrawn.');
    const venue = (await getVenueRow(r.venue_id).catch(() => null))?.name ?? 'the turf';
    if (!accept) {
      await c.query("update player_request_members set status = 'declined', decided_at = now() where request_id = $1 and user_id = $2", [id, memberId]);
      await notify(c, memberId, 'Not this time', `The organiser couldn't fit you into the game at ${venue}. Plenty more games nearby.`, { type: 'match_declined', matchId: id });
      return;
    }
    const start = kickoff(r);
    if (start - Date.now() < (CLOSE_BEFORE_MIN + 5) * 60_000) throw new ApiError('forbidden', 'It is too close to kick-off to add players.');
    const taken = await spotsTaken(c, id);
    const free = r.spots_total - taken;
    if (free <= 0) throw new ApiError('conflict', 'All spots are taken right now. Someone may still be paying; try again in a few minutes.');
    if (m.spots > free) throw new ApiError('conflict', `This request is for ${m.spots} spots but only ${free} ${free === 1 ? 'is' : 'are'} free right now.`);
    const payBy = new Date(Math.min(Date.now() + PAY_WINDOW_MIN * 60_000, start - CLOSE_BEFORE_MIN * 60_000));
    await c.query("update player_request_members set status = 'accepted', decided_at = now(), pay_by = $3 where request_id = $1 and user_id = $2", [id, memberId, payBy]);
    const by = payBy.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true });
    await notify(
      c,
      memberId,
      "You're in! Pay to confirm",
      `${venue}, ${timeLabel(r.day, r.start_min)}. Pay ${taka(r.share * m.spots)} by ${by} (${PAY_WINDOW_MIN} minutes) to keep your ${m.spots === 1 ? 'spot' : `${m.spots} spots`}.`,
      { type: 'match_accepted', matchId: id },
    );
  });
  return manage(userId, id);
}

// ── Player ─────────────────────────────────────────────────────────────────

export async function requestToJoin(userId: string, id: string, input: { position: Position; level: Level; spots?: number; sharePhone?: true }) {
  const spots = Math.max(1, Math.floor(input.spots ?? 1));
  await tx(async (c) => {
    const r = (
      await c.query<{ user_id: string; status: string; spots_total: number; day: string; start_min: number; title: string; venue_id: string }>(
        `select r.user_id, r.status, r.spots_total, b.day::text, b.start_min, r.title, b.venue_id
           from player_requests r join bookings b on b.id = r.booking_id where r.id = $1 for update of r`,
        [id],
      )
    ).rows[0];
    if (!r || r.status === 'cancelled') throw new ApiError('not_found', 'This match is no longer available.');
    if (r.user_id === userId) throw new ApiError('forbidden', 'This is your own match.');
    if (r.status !== 'open') throw new ApiError('forbidden', 'The organiser has paused new requests.');
    if (kickoff(r) - Date.now() < CLOSE_BEFORE_MIN * 60_000) throw new ApiError('forbidden', 'Requests have closed for this game.');
    const m = (await c.query<{ status: string }>('select status from player_request_members where request_id = $1 and user_id = $2 for update', [id, userId])).rows[0];
    if (m && ['pending', 'accepted', 'paid'].includes(m.status)) return; // already asked: idempotent
    // Declined, withdrawn or let the pay window pass: asking again is fine.
    const free = r.spots_total - (await spotsTaken(c, id));
    if (free <= 0) throw new ApiError('conflict', 'This game is full.');
    if (spots > free) throw new ApiError('conflict', `Only ${free} ${free === 1 ? 'spot is' : 'spots are'} left. Lower the number and try again.`);
    await c.query(
      `insert into player_request_members (request_id, user_id, status, position, level, spots, created_at, phone_consent_at) values ($1,$2,'pending',$3,$4,$5, now(), now())
       on conflict (request_id, user_id) do update set status = 'pending', position = $3, level = $4, spots = $5, created_at = now(), decided_at = null, pay_by = null,
         phone_consent_at = now()`,
      [id, userId, input.position, input.level, spots],
    );
    const who = (await c.query<{ name: string }>('select name from users where id = $1', [userId])).rows[0]?.name ?? 'A player';
    const n = spots === 1 ? '' : ` with ${spots - 1} friend${spots === 2 ? '' : 's'}`;
    await notify(c, r.user_id, 'New request to join', `${who} wants to join "${r.title}"${n}.`, { type: 'match_request', matchId: id });
  });
  return getMatch(userId, id);
}

/** Leave before paying (a pending request, or an accepted spot you no longer want). */
export async function withdraw(userId: string, id: string) {
  const res = await q<{ status: string }>(
    "update player_request_members set status = 'withdrawn' where request_id = $1 and user_id = $2 and status in ('pending', 'accepted') returning status",
    [id, userId],
  );
  if (!res.length) {
    const m = await one<{ status: string }>('select status from player_request_members where request_id = $1 and user_id = $2', [id, userId]);
    if (m?.status === 'paid') throw new ApiError('forbidden', "You've paid for this game. Ask the organiser if you can't make it.");
  }
  return getMatch(userId, id);
}

/** Reconcile: let unpaid accepted spots go back to the pool and tell the player. */
export async function expireUnpaid() {
  const gone = await q<{ request_id: string; user_id: string }>(
    `update player_request_members m set status = 'expired'
      where m.status = 'accepted' and m.pay_by < now() and not ${HOLDING}
      returning m.request_id, m.user_id`,
  );
  for (const g of gone)
    await notify({ query: (s, p) => q(s, p as unknown[]) }, g.user_id, 'Spot released', 'The time to pay for your spot ran out, so it went back to the game.', {
      type: 'match_expired',
      matchId: g.request_id,
    });
  return gone.length;
}

/** The organiser cancelled the booking: the match is off; anyone who paid is flagged for a refund. */
export async function onBookingCancelled(bookingId: string) {
  const r = await one<{ id: string }>("update player_requests set status = 'cancelled', updated_at = now() where booking_id = $1 and status <> 'cancelled' returning id", [bookingId]);
  if (!r) return;
  const paid = await q<{ user_id: string }>("select user_id from player_request_members where request_id = $1 and status in ('paid', 'accepted', 'pending')", [r.id]);
  await q("update payments set status = 'refund_required', updated_at = now() where match_id = $1 and kind = 'share' and status = 'completed'", [r.id]);
  for (const p of paid)
    await notify({ query: (s, x) => q(s, x as unknown[]) }, p.user_id, 'Game cancelled', "The organiser cancelled this game. If you paid, a full refund is on its way.", {
      type: 'match_cancelled',
      matchId: r.id,
    });
}
