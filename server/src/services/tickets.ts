/**
 * Tickets outside the app: the shareable ticket link, the ticket PDF and the QR the owner sees.
 *
 * Link: api.turfsides.com/ticket/<token>. The token is 23 random letters and digits (about 137 bits:
 * guessing any one of a billion live tickets would take ~10^32 tries), made the first time the link
 * is needed and kept on the booking. Anyone with the link sees that one ticket, so it's only ever
 * given to the person who booked (their email, their app, the owner's dashboard).
 *
 * The QR is the same signed entry pass the app shows (TSP2…), so reception scans and checks it in
 * the same way. Back-to-back slots bought together are one ticket, like in the app.
 */
import { randomBytes } from 'node:crypto';

import { config } from '../config';
import { one, q } from '../db';
import { ApiError } from '../errors';
import { instant } from '../lib/time';
import { signPass2 } from '../lib/tokens';

export const TICKET_TOKEN = /^[A-Za-z0-9]{23}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 23 characters, each uniformly one of 62 (rejection sampling: no modulo bias). */
export function newTicketToken() {
  let out = '';
  while (out.length < 23) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < 23) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const ticketUrl = (token: string) => `${config.PUBLIC_URL.replace(/\/+$/, '')}/ticket/${token}`;

type Row = {
  id: string;
  code: string;
  status: string;
  source: string;
  day: string;
  start_min: number;
  end_min: number;
  total: string;
  order_id: string | null;
  user_id: string | null;
  pitch_id: string;
  ticket_token: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  user_name: string | null;
  user_phone: string | null;
  user_email: string | null;
  venue_id: string;
  venue: string;
  area: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  map_url: string | null;
  formats: string[] | null;
  owner_id: string | null;
  pitch: string | null;
};
const SELECT = `
  select b.id, b.code, b.status, b.source, b.day::text, b.start_min, b.end_min, b.total, b.order_id, b.user_id, b.pitch_id,
         b.ticket_token, b.guest_name, b.guest_phone, b.guest_email, u.name user_name, u.phone user_phone, u.email user_email,
         v.id venue_id, v.name venue, v.area, v.city, v.address, v.lat, v.lng, v.map_url, v.formats, v.owner_id,
         (select name from pitches pi where pi.id = b.pitch_id) pitch
    from bookings b join venues v on v.id = b.venue_id left join users u on u.id = b.user_id`;
const SHOWN = ['confirmed', 'checked_in', 'completed', 'cancelled'];

/** 10 national digits from "+8801712345678", "01712345678" or "1712345678"; '' if none. */
const digits10 = (p: string | null) => {
  let d = (p ?? '').replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
};
const maskPhone = (p: string) => (p.length >= 7 ? `${p.slice(0, 3)}${'*'.repeat(p.length - 6)}${p.slice(-3)}` : p);
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * App tickets: the back-to-back slots of the same payment that this one belongs to (same day and
 * pitch, all cancelled or none), first slot first. Others: just this slot.
 */
async function runOf(r: Row) {
  if (!r.order_id) return [r];
  const all = await q<Row>(`${SELECT} where b.order_id = $1 and b.status = any($2::text[]) order by b.day, b.start_min`, [r.order_id, SHOWN]);
  let group: Row[] = [];
  for (const x of all) {
    const last = group.at(-1);
    const joins = last && last.day === x.day && last.end_min === x.start_min && last.pitch_id === x.pitch_id && (last.status === 'cancelled') === (x.status === 'cancelled');
    if (!joins) {
      if (group.some((g) => g.id === r.id)) break;
      group = [];
    }
    group.push(x);
  }
  return group.some((g) => g.id === r.id) ? group : [r];
}

export type TicketView = Awaited<ReturnType<typeof view>>;

async function view(r: Row) {
  const run = await runOf(r);
  const lead = run[0]!;
  const start = lead.start_min;
  const end = run.at(-1)!.end_min;
  const amount = Math.round(run.reduce((n, x) => n + Number(x.total), 0) / 100);
  const endAt = instant(lead.day, end).getTime();
  const status = lead.status === 'confirmed' && endAt < Date.now() ? 'completed' : lead.status;
  const walkin = lead.source === 'walkin';
  // Walk-ins carry the name and phone the turf took; app bookings the player's own.
  const name = (walkin ? lead.guest_name : null) ?? lead.user_name ?? lead.guest_name ?? 'Guest';
  const phone = digits10(walkin ? (lead.guest_phone ?? lead.user_phone) : (lead.user_phone ?? lead.guest_phone));
  const email = (walkin ? (lead.guest_email ?? lead.user_email) : (lead.user_email ?? lead.guest_email)) ?? null;
  const format = lead.formats?.[0] ?? '';
  const pass =
    status === 'confirmed' || status === 'checked_in'
      ? signPass2({
          code: lead.code,
          venue: lead.venue,
          area: lead.area ?? '',
          pitch: lead.pitch ?? 'Main pitch',
          format,
          date: lead.day,
          from: hhmm(start),
          to: hhmm(end),
          name,
          phone: maskPhone(phone),
          paid: amount,
          via: walkin ? 'At the turf' : 'bKash',
          exp: Math.floor(endAt / 1000) + 6 * 3600,
        })
      : '';
  return {
    id: lead.id,
    ids: run.map((x) => x.id),
    code: lead.code,
    status: status as 'confirmed' | 'checked_in' | 'completed' | 'cancelled',
    source: walkin ? ('walkin' as const) : ('app' as const),
    day: lead.day,
    start,
    end,
    amount,
    name,
    phone: phone ? `+880${phone}` : null,
    email,
    userId: lead.user_id,
    ownerId: lead.owner_id,
    venue: {
      id: lead.venue_id,
      name: lead.venue,
      area: lead.area ?? '',
      city: lead.city ?? '',
      address: lead.address ?? '',
      lat: lead.lat,
      lng: lead.lng,
      mapUrl: lead.map_url,
      format,
    },
    pitch: lead.pitch ?? 'Main pitch',
    pass,
    token: lead.ticket_token,
  };
}

/** Gives the booking its link token if it has none yet (once; the same token from then on). */
async function ensureToken(id: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await one<{ ticket_token: string }>(
        'update bookings set ticket_token = coalesce(ticket_token, $2) where id = $1 returning ticket_token',
        [id, newTicketToken()],
      );
      if (!r) throw new ApiError('not_found', 'Booking not found.');
      return r.ticket_token;
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e; // a token clash (never in practice): draw again
    }
  }
  throw new ApiError('internal', 'Could not make the ticket link. Try again.');
}

/** The ticket a booking belongs to, with its link (made if needed). */
export async function ticketById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError('not_found', 'Booking not found.');
  const r = await one<Row>(`${SELECT} where b.id = $1 and b.status = any($2::text[])`, [id, SHOWN]);
  if (!r) throw new ApiError('not_found', 'Booking not found.');
  const v = await view(r);
  const token = v.token ?? (await ensureToken(v.id));
  return { ...v, token, url: ticketUrl(token) };
}

/** The ticket behind a link, or null. */
export async function ticketByToken(token: string) {
  if (!TICKET_TOKEN.test(token)) return null;
  const r = await one<Row>(`${SELECT} where b.ticket_token = $1 and b.status = any($2::text[])`, [token, SHOWN]);
  if (!r) return null;
  const v = await view(r);
  return { ...v, token, url: ticketUrl(token) };
}

/** For the owner's dashboard: only their own turfs' bookings. */
export async function ticketForOwner(ownerId: string, id: string) {
  const t = await ticketById(id);
  if (t.ownerId !== ownerId) throw new ApiError('not_found', 'Booking not found.');
  return t;
}

// ── Labels, as the app writes them ────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (minutes: number, withPeriod = true) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${withPeriod ? (h < 12 ? ' AM' : ' PM') : ''}`;
};
/** "8:00–9:00 PM" / "11:30 AM–12:30 PM" */
export const appRange = (start: number, end: number) => {
  const same = Math.floor((start % 1440) / 720) === Math.floor((end % 1440) / 720);
  return `${clock(start, !same)}–${clock(end)}`;
};
/** "Sat 21 · 8:00–9:00 PM": the QR card's second line in the app. */
export const appSubtitle = (t: { day: string; start: number; end: number }) => {
  const d = new Date(`${t.day}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} · ${appRange(t.start, t.end)}`;
};
/** The ticket PDF's file name. */
export const pdfName = (code: string) => `TurfSides-ticket-${code.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
