/**
 * Booking emails. Fire-and-forget: a failed email never affects the payment or the booking.
 *  - App booking paid (payments.finalize): the player gets "your booking is confirmed" with a link to
 *    their ticket; the turf owner gets "you got a new booking".
 *  - Walk-in added by the owner (owner-dash.createWalkin): the customer gets the same confirmation,
 *    with the ticket PDF attached (built in memory when sending, never stored) and the ticket link.
 */
import { config } from '../config';
import { one, q } from '../db';
import { emailEnabled, sendEmail, type Attachment } from '../lib/email';
import { ticketPdf } from '../lib/ticket-pdf';
import { addDays } from '../lib/time';

import { appSubtitle, pdfName, ticketById, type TicketView } from './tickets';

// ── Data ─────────────────────────────────────────────────────────────────────

type SlotRow = {
  id: string;
  code: string;
  day: string;
  start_min: number;
  end_min: number;
  total: number; // poisha
  note: string | null;
  pitch: string | null;
  user_id: string;
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
};

export type Ticket = { leadId: string; code: string; day: string; start: number; end: number; pitch: string; amount: number; url?: string };

export type BookingMail = {
  player: { name: string; phone: string; email: string | null };
  /** app = paid in the app (bKash); walkin = added by the turf from its dashboard. */
  source?: 'app' | 'walkin';
  /** The customer has a TurfSides account, so the booking is in their app too. */
  onApp?: boolean;
  venue: { name: string; area: string; city: string; address: string; lat: number | null; lng: number | null; format: string; mapUrl?: string | null };
  tickets: Ticket[];
  paid: number; // taka, what the player paid
  /** Partial payment: taka still to pay at the turf (0 or absent = fully paid). */
  due?: number;
  trxId: string | null;
  note: string | null;
  bookedAt: Date;
};

/** Back-to-back slots on the same day and pitch read as one ticket (the app does the same). */
function toTickets(rows: SlotRow[]): Ticket[] {
  const out: Ticket[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    const pitch = r.pitch ?? 'Main pitch';
    if (last && last.day === r.day && last.end === r.start_min && last.pitch === pitch) {
      last.end = r.end_min;
      last.amount += r.total;
    } else out.push({ leadId: r.id, code: r.code, day: r.day, start: r.start_min, end: r.end_min, pitch, amount: r.total });
  }
  // A session listed under a day but starting after midnight (start ≥ 24:00) happens on the next
  // calendar date: the email shows the real date, so nobody turns up a day late.
  return out.map((t) => {
    const shift = t.start >= 1440 ? 1440 : 0;
    return { ...t, day: shift ? addDays(t.day, 1) : t.day, start: t.start - shift, end: t.end - shift, amount: Math.round(t.amount / 100) };
  });
}

/** Sends both emails for a just-confirmed payment. Never throws. */
type Mail = { to: string; toName?: string; subject: string; html: string; text: string; attachments?: Attachment[] };
/** Test servers (EMAIL_DRY_RUN): what would have been sent. */
export const emailsForTests: (Mail & { kind: 'player' | 'owner' | 'walkin'; paymentId: string })[] = [];

export async function sendBookingEmails(paymentId: string) {
  const dry = config.EMAIL_DRY_RUN && config.NODE_ENV !== 'production';
  if (!dry && !emailEnabled()) return;
  const deliver = async (kind: 'player' | 'owner', m: Mail) => {
    if (dry) emailsForTests.push({ ...m, kind, paymentId });
    else await sendEmail(m);
  };
  try {
    const p = await one<{ booking_id: string; order_id: string | null; amount: number; trx_id: string | null; user_id: string }>(
      'select booking_id, order_id, amount, trx_id, user_id from payments where id = $1 and status = $2',
      [paymentId, 'completed'],
    );
    if (!p) return;
    const rows = await q<SlotRow>(
      `select b.id, b.code, b.day::text, b.start_min, b.end_min, b.total, b.note, b.user_id, b.venue_id,
              (select name from pitches pi where pi.id = b.pitch_id) as pitch,
              v.name as venue, v.area, v.city, v.address, v.lat, v.lng, v.map_url, v.formats, v.owner_id
         from bookings b join venues v on v.id = b.venue_id
        where ${p.order_id ? 'b.order_id = $1' : 'b.id = $1'} and b.status = 'confirmed'
        order by b.day, b.start_min`,
      [p.order_id ?? p.booking_id],
    );
    if (!rows.length) return;
    const user = await one<{ name: string; phone: string; email: string | null }>('select name, phone, email from users where id = $1', [p.user_id]);
    if (!user) return;
    const v = rows[0];
    // Each ticket's link (made now if it has none). A link that can't be made just isn't shown.
    const tickets = await Promise.all(
      toTickets(rows).map(async (t) => ({ ...t, url: await ticketById(t.leadId).then((x) => x.url, () => undefined) })),
    );
    const mail: BookingMail = {
      player: user,
      source: 'app',
      onApp: true,
      venue: { name: v.venue, area: v.area ?? '', city: v.city ?? '', address: v.address ?? '', lat: v.lat, lng: v.lng, mapUrl: v.map_url, format: v.formats?.[0] ?? '' },
      tickets,
      paid: Math.round(p.amount / 100),
      due: Math.max(0, Math.round(rows.reduce((n, r) => n + Number(r.total), 0) / 100) - Math.round(p.amount / 100)),
      trxId: p.trx_id,
      note: rows.find((r) => r.note)?.note ?? null,
      bookedAt: new Date(),
    };

    const jobs: Promise<unknown>[] = [];
    if (user.email) {
      const m = playerEmail(mail);
      jobs.push(deliver('player', { to: user.email, toName: user.name, ...m }));
    }
    const owner = v.owner_id
      ? await one<{ name: string; email: string | null; notify_enabled: boolean }>(
          'select name, email, notify_enabled from owners where id = $1 and deleted_at is null',
          [v.owner_id],
        )
      : null;
    if (owner?.email && owner.notify_enabled) {
      const m = ownerEmail(mail, owner.name);
      jobs.push(deliver('owner', { to: owner.email, toName: owner.name, ...m }));
    }
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === 'rejected') console.error(`[email] booking email failed for payment ${paymentId}`);
  } catch (e) {
    console.error(`[email] booking emails for payment ${paymentId}: ${(e as Error).message}`);
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

const base = () => config.PUBLIC_URL.replace(/\/+$/, '');
const img = (f: string) => `${base()}/static/brand/${f}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const taka = (n: number) => `৳${n.toLocaleString('en-IN')}`;
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** 450 → "7:30 AM"; 1500 → "1:00 AM" (sessions can run past midnight). */
export function clock(min: number) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export const timeRange = (s: number, e: number) => `${clock(s)} – ${clock(e)}${e > 1440 && s < 1440 ? ' (after midnight)' : ''}`;
export function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h} hour${h > 1 ? 's' : ''}` : `${m} min`;
}
/** "Thursday, 19 November 2026" */
export const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "19 Nov 2026, 12:26 AM" in Dhaka time. */
const dhakaStamp = (d: Date) => {
  const local = new Date(d.getTime() + 6 * 3600_000);
  const day = local.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${day}, ${clock(local.getUTCHours() * 60 + local.getUTCMinutes())}`;
};
const phoneIntl = (p: string) => `+880 ${p.slice(0, 4)}-${p.slice(4)}`;
const place = (v: BookingMail['venue']) => [v.area, v.city].filter(Boolean).join(', ');
/** Street address plus area and city, without repeating what the address already says. */
const fullAddress = (v: BookingMail['venue']) => {
  const a = v.address.trim();
  const extra = [v.area, v.city].filter((x) => x && !a.toLowerCase().includes(x.toLowerCase()));
  return [a, ...extra].filter(Boolean).join(', ') || v.name;
};
const mapsUrl = (v: BookingMail['venue']) =>
  v.mapUrl ||
  (v.lat != null && v.lng != null && (v.lat !== 0 || v.lng !== 0)
    ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address, place(v)].filter(Boolean).join(', '))}`);

// ── Layout pieces (tables + inline styles: the only layout every mail app agrees on) ──

const C = { ink: '#161B1D', dim: '#5C6468', faint: '#8A9196', line: '#E6E8E2', bg: '#F3F3EF', soft: '#F7F8F4', lime: '#DDF85C', limeSoft: '#F3FCCB', limeText: '#4E6B00' };
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Playfair Display',Georgia,'Times New Roman',serif";

/** The card's dark header with the TurfSides logo, like the verification email. */
function shell(o: { preheader: string; body: string; footer: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<title>TurfSides</title>
<style>
  @media (max-width:520px){ .px{padding-left:20px!important;padding-right:20px!important} .hd{padding-left:22px!important;padding-right:22px!important} .h1{font-size:23px!important;line-height:30px!important} .lbl{width:96px!important} .cardpad{padding-left:16px!important;padding-right:16px!important} .cap{letter-spacing:0.6px!important} .paidcol{width:104px!important} .amt{font-size:21px!important} .h2{font-size:20px!important;line-height:26px!important} }
  a{color:${C.ink}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${SANS};color:${C.ink};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:#FFFFFF;border-radius:28px;overflow:hidden;border:1px solid ${C.line}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="hd" style="background:${C.ink};padding:24px 28px;border-radius:27px 27px 0 0"><img src="${img('email-wordmark.png')}" width="171" height="32" alt="TurfSides" style="display:block;border:0;outline:none;height:32px;width:171px;color:#FFFFFF;font-size:22px;font-weight:800"></td></tr>
${o.body}
</table></td></tr>
<tr><td class="px" style="padding:22px 28px 0;font-size:12px;line-height:18px;color:${C.faint};text-align:center">${o.footer}<br>TurfSides · Book a turf. Find your squad.</td></tr>
</table></td></tr></table></body></html>`;
}

const row = (label: string, value: string, last = false) => `<tr>
<td class="lbl" valign="top" style="width:132px;padding:12px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}font-size:13px;color:${C.faint}">${label}</td>
<td valign="top" style="padding:12px 0;${last ? '' : `border-bottom:1px solid ${C.line};`}font-size:14px;line-height:20px;color:${C.ink};font-weight:500">${value}</td></tr>`;
const rows = (r: [string, string][]) => r.map(([l, v], i) => row(l, v, i === r.length - 1)).join('');

const headline = (title: string, sub: string) => `<tr><td class="px" align="center" style="padding:34px 40px 8px">
<h1 class="h1" style="margin:0;font-family:${SERIF};font-weight:500;font-size:26px;line-height:34px;color:${C.ink};letter-spacing:-0.2px">${title}</h1>
<p style="margin:12px 0 0;font-size:16px;line-height:24px;color:${C.dim}">${sub}</p></td></tr>`;

const ticketLines = (t: Ticket[]) =>
  t.map((x) => `<div style="margin:0 0 2px">${esc(shortDay(x.day))} · ${esc(timeRange(x.start, x.end))}</div>`).join('');

const totalMinutes = (t: Ticket[]) => t.reduce((n, x) => n + (x.end - x.start), 0);

// ── Player ───────────────────────────────────────────────────────────────────

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${C.ink};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;border-radius:14px;padding:14px 26px">${label}</a>`;

/** The ticket links: one button, or one line per ticket. */
function ticketLinks(t: Ticket[]) {
  const linked = t.filter((x) => x.url);
  if (!linked.length) return '';
  const inner =
    linked.length === 1
      ? button(linked[0]!.url!, 'View your ticket')
      : `<p style="margin:0 0 10px;font-size:13px;color:${C.faint}">Your tickets</p>${linked
          .map(
            (x) =>
              `<p style="margin:0 0 8px"><a href="${esc(x.url!)}" style="color:${C.limeText};font-weight:600;text-decoration:none">${esc(x.code)} · ${esc(shortDay(x.day))}, ${esc(clock(x.start))} →</a></p>`,
          )
          .join('')}`;
  return `<tr><td class="px" align="center" style="padding:22px 28px 0">${inner}</td></tr>`;
}

export function playerEmail(m: BookingMail) {
  const t0 = m.tickets[0];
  const many = m.tickets.length > 1;
  const v = m.venue;
  const walkin = m.source === 'walkin';
  const when = `${shortDay(t0.day)}, ${clock(t0.start)}`;
  const subject = `Booking confirmed: ${v.name}, ${when}`;
  const details: [string, string][] = [
    ['Date', many ? ticketLines(m.tickets) : esc(longDay(t0.day))],
    ...(many ? [] : [['Time', esc(timeRange(t0.start, t0.end))] as [string, string]]),
    ['Duration', esc(duration(totalMinutes(m.tickets)))],
    ['Pitch', esc([t0.pitch, v.format].filter(Boolean).join(' · '))],
    [
      'Address',
      `${esc(fullAddress(v))}<br><a href="${mapsUrl(v)}" style="color:${C.limeText};font-weight:600;text-decoration:none">Get directions →</a>`,
    ],
    walkin
      ? ['Amount', `${taka(m.paid)} <span style="color:${C.faint};font-weight:400">· booked at the turf</span>`]
      : ['Paid', `${taka(m.paid)} <span style="color:${C.faint};font-weight:400">via bKash</span>`],
    ...(m.due ? [['Due at the turf', `<strong>${taka(m.due)}</strong> <span style="color:${C.faint};font-weight:400">· pay at the turf before you play</span>`] as [string, string]] : []),
    ...(m.trxId ? [['Transaction ID', `<span style="font-family:Menlo,Consolas,monospace;font-size:13px">${esc(m.trxId)}</span>`] as [string, string]] : []),
    ...(m.note && !walkin ? [['Your note', esc(m.note)] as [string, string]] : []),
  ];

  const sub = walkin
    ? `${esc(v.name)} booked this for you. Your ticket is attached${m.onApp ? ' and in your TurfSides app' : ''}. See you on the pitch.`
    : 'Your booking has been confirmed. See you on the pitch.';
  const atTurf = walkin
    ? `show the QR code at the front desk: it’s in the attached PDF and on your ticket page${m.onApp ? ', and in the TurfSides app under Bookings' : ''}.${many ? ` Each time slot has its own ticket.` : ''}
    Need to change or cancel? Contact ${esc(v.name)} directly.`
    : `show your entry pass in the TurfSides app at the front desk.${many ? ` Your ${m.tickets.length} time slots each have their own pass in the app.` : ''}
    Need to cancel? Open the booking in the app; the turf’s refund policy is shown there.`;
  const body = `${headline(`Congratulations, ${esc(first(m.player.name))}!`, sub)}
<tr><td class="px" style="padding:24px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:20px">
    <tr><td class="cardpad" style="padding:22px 22px 18px;border-bottom:1px solid ${C.line}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top">
          <p class="cap" style="margin:0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.faint};font-weight:600;white-space:nowrap">Booking ${esc(t0.code)}</p>
          <p style="margin:8px 0 0;font-family:${SERIF};font-size:19px;line-height:25px;font-weight:600;color:${C.ink}">${esc(v.name)}</p>
          <p style="margin:4px 0 0;font-size:14px;color:${C.dim}">${esc(place(v))}</p>
          <p style="margin:14px 0 0"><span style="display:inline-block;white-space:nowrap;background:${C.limeSoft};color:${C.limeText};font-size:13px;font-weight:600;border-radius:999px;padding:6px 12px">${esc(when)}</span></p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="cardpad" style="padding:4px 22px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows(details)}</table>
    </td></tr>
  </table>
</td></tr>
${ticketLinks(m.tickets)}
<tr><td class="px" style="padding:18px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft};border-radius:16px"><tr><td style="padding:16px 18px;font-size:13.5px;line-height:21px;color:${C.dim}">
    <strong style="color:${C.ink}">At the turf:</strong> arrive 10 minutes early and ${atTurf}
  </td></tr></table>
</td></tr>
<tr><td class="px" align="center" style="padding:30px 40px 36px">
  <p style="margin:0;font-family:${SERIF};font-size:20px;line-height:28px;color:${C.ink}">Thank you for using TurfSides.</p>
  <p style="margin:6px 0 0;font-size:14px;line-height:21px;color:${C.dim}">Have a great game. We’ll be here when you’re ready for the next one.</p>
</td></tr>`;

  const html = shell({
    preheader: `Your booking at ${v.name} is confirmed: ${longDay(t0.day)}, ${timeRange(t0.start, t0.end)}.`,
    body,
    footer: walkin
      ? `You’re getting this because ${esc(v.name)} booked a session for you with this email address.`
      : `You’re getting this because you booked on TurfSides with this email address.`,
  });

  const links = m.tickets.filter((x) => x.url).map((x) => `Ticket ${x.code}: ${x.url}`);
  const text = [
    `Congratulations, ${first(m.player.name)}! ${walkin ? `${v.name} booked this for you.` : 'Your booking has been confirmed.'}`,
    '',
    `${v.name}${place(v) ? ` (${place(v)})` : ''}`,
    `Booking ${t0.code}`,
    ...m.tickets.map((x) => `${longDay(x.day)}, ${timeRange(x.start, x.end)}`),
    `Duration: ${duration(totalMinutes(m.tickets))}`,
    `Pitch: ${[t0.pitch, v.format].filter(Boolean).join(' · ')}`,
    `Address: ${fullAddress(v)}`,
    `Directions: ${mapsUrl(v)}`,
    walkin ? `Amount: ${taka(m.paid)} (booked at the turf)` : `Paid: ${taka(m.paid)} via bKash${m.trxId ? ` (transaction ${m.trxId})` : ''}`,
    ...(m.due ? [`Due at the turf: ${taka(m.due)} (pay at the turf before you play)`] : []),
    ...(m.note && !walkin ? [`Your note: ${m.note}`] : []),
    ...(links.length ? ['', ...links] : []),
    '',
    walkin
      ? 'At the turf, show the QR code at the front desk: it is in the attached PDF and on your ticket page.'
      : 'At the turf, show your entry pass in the TurfSides app at the front desk.',
    '',
    'Thank you for using TurfSides. Have a great game!',
  ].join('\n');

  return { subject, html, text };
}

// ── Owner ────────────────────────────────────────────────────────────────────

export function ownerEmail(m: BookingMail, ownerName: string) {
  const t0 = m.tickets[0];
  const many = m.tickets.length > 1;
  const v = m.venue;
  const subject = `New booking: ${v.name}, ${shortDay(t0.day)} ${clock(t0.start)}`;
  const phone = phoneIntl(m.player.phone);
  const details: [string, string][] = [
    ['Customer', `${esc(m.player.name)} <span style="color:${C.faint};font-weight:400">· TurfSides app</span>`],
    ['Phone', `<a href="tel:+880${m.player.phone}" style="color:${C.ink};text-decoration:none">${esc(phone)}</a>`],
    ['Date', many ? ticketLines(m.tickets) : esc(longDay(t0.day))],
    ...(many ? [] : [['Time', esc(timeRange(t0.start, t0.end))] as [string, string]]),
    ['Duration', esc(duration(totalMinutes(m.tickets)))],
    ['Pitch', esc([t0.pitch, v.format].filter(Boolean).join(' · '))],
    ['Booking code', `<span style="font-family:Menlo,Consolas,monospace;font-size:13px">${esc(m.tickets.map((x) => x.code).join(', '))}</span>`],
    ['Paid', `${taka(m.paid)} <span style="color:${C.faint};font-weight:400">via bKash${m.trxId ? ` · ${esc(m.trxId)}` : ''}</span>`],
    ...(m.due ? [['Collect at the turf', `<strong>${taka(m.due)}</strong> <span style="color:${C.faint};font-weight:400">· the player paid 500 tk per slot in the app</span>`] as [string, string]] : []),
    ['Booked', esc(dhakaStamp(m.bookedAt))],
    ...(m.note ? [['Customer note', esc(m.note)] as [string, string]] : []),
  ];

  const body = `${headline('Congrats, you got a new booking', `${esc(first(m.player.name))} booked ${esc(v.name)} in the TurfSides app. ${m.due ? `${esc(taka(m.paid))} is paid in the app; collect ${esc(taka(m.due))} at the turf. The time` : 'It’s paid, and the time'} is now closed to other players.`)}
<tr><td class="px" style="padding:24px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:20px">
    <tr><td class="cardpad" style="padding:22px 22px 18px;border-bottom:1px solid ${C.line}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" style="padding-right:14px">
          <p style="margin:0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.faint};font-weight:600">${esc(v.name)}</p>
          <p class="h2" style="margin:8px 0 0;font-family:${SERIF};font-size:24px;line-height:30px;font-weight:600;color:${C.ink}">${esc(shortDay(t0.day))}, <span style="white-space:nowrap">${esc(clock(t0.start))}</span></p>
          <p style="margin:4px 0 0;font-size:14px;color:${C.dim}">${many ? `${m.tickets.length} time slots` : esc(timeRange(t0.start, t0.end))} · ${esc(duration(totalMinutes(m.tickets)))}</p>
        </td>
        <td class="paidcol" valign="top" align="right" style="width:150px">
          <p style="margin:0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.faint};font-weight:600">Paid</p>
          <p class="amt" style="margin:6px 0 0;font-size:26px;line-height:30px;font-weight:700;color:${C.ink};white-space:nowrap">${taka(m.paid)}</p>
          <p style="margin:8px 0 0"><span style="display:inline-block;background:${C.limeSoft};color:${C.limeText};font-size:12px;font-weight:600;border-radius:999px;padding:5px 10px">Confirmed</span></p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="cardpad" style="padding:4px 22px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows(details)}</table>
    </td></tr>
  </table>
</td></tr>
<tr><td class="px" style="padding:16px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft};border-radius:16px"><tr><td style="padding:16px 18px;font-size:13.5px;line-height:21px;color:${C.dim}">
    <strong style="color:${C.ink}">When they arrive:</strong> ${esc(first(m.player.name))} will show an entry-pass QR. Scan it with the TurfSides owner app to check them in, or check them in from Schedule on your dashboard.
  </td></tr></table>
</td></tr>
<tr><td class="px" align="center" style="padding:30px 40px 36px">
  <p style="margin:0;font-family:${SERIF};font-size:20px;line-height:28px;color:${C.ink}">Thank you for hosting on TurfSides.</p>
  <p style="margin:6px 0 0;font-size:14px;line-height:21px;color:${C.dim}">Here’s to a full pitch.</p>
</td></tr>`;

  const html = shell({
    preheader: `${m.player.name} booked ${longDay(t0.day)}, ${timeRange(t0.start, t0.end)}. Paid ${taka(m.paid)}${m.due ? `, ${taka(m.due)} to collect at the turf` : ''}.`,
    body,
    footer: `Sent to ${esc(first(ownerName))} as the owner of ${esc(v.name)}.`,
  });

  const text = [
    'Congrats, you got a new booking!',
    '',
    `${m.player.name} booked ${v.name} in the TurfSides app. ${m.due ? `${taka(m.paid)} is paid in the app; collect ${taka(m.due)} at the turf. The time` : "It's paid, and the time"} is now closed to other players.`,
    '',
    `Customer: ${m.player.name}`,
    `Phone: ${phone}`,
    ...m.tickets.map((x) => `${longDay(x.day)}, ${timeRange(x.start, x.end)} (${x.code})`),
    `Duration: ${duration(totalMinutes(m.tickets))}`,
    `Pitch: ${[t0.pitch, v.format].filter(Boolean).join(' · ')}`,
    `Paid: ${taka(m.paid)} via bKash${m.trxId ? ` (transaction ${m.trxId})` : ''}`,
    ...(m.due ? [`Collect at the turf: ${taka(m.due)} (the player paid 500 tk per slot in the app)`] : []),
    `Booked: ${dhakaStamp(m.bookedAt)}`,
    ...(m.note ? [`Customer note: ${m.note}`] : []),
    '',
    'Thank you for hosting on TurfSides.',
  ].join('\n');

  return { subject, html, text };
}

// ── Walk-in ticket ───────────────────────────────────────────────────────────

/** The ticket PDF for these tickets (one page each), built now, never stored. */
export const pdfOf = (t: TicketView[]) =>
  ticketPdf(
    t.filter((x) => x.pass).map((x) => ({ title: x.venue.name, subtitle: appSubtitle(x), code: x.code, pass: x.pass })),
    `TurfSides ticket ${t.map((x) => x.code).join(', ')}`,
  );

/**
 * A walk-in's confirmation to the customer's email: the details, the ticket link(s) and the ticket
 * PDF attached (one file per ticket). Never throws. Returns whether an email went out.
 */
export async function sendWalkinTicket(bookingIds: string[], opts: { to?: string } = {}) {
  const dry = config.EMAIL_DRY_RUN && config.NODE_ENV !== 'production';
  if (!dry && !emailEnabled()) return false;
  try {
    const seen = new Set<string>();
    const list: (TicketView & { url: string })[] = [];
    for (const id of bookingIds) {
      const t = await ticketById(id);
      if (!seen.has(t.id) && (t.status === 'confirmed' || t.status === 'checked_in')) list.push(t);
      seen.add(t.id);
    }
    list.sort((a, b) => (a.day === b.day ? a.start - b.start : a.day < b.day ? -1 : 1));
    const t0 = list[0];
    const to = opts.to ?? t0?.email;
    if (!t0 || !to) return false;
    const v = t0.venue;
    const mail: BookingMail = {
      player: { name: t0.name, phone: (t0.phone ?? '').replace(/^\+880/, ''), email: to },
      source: 'walkin',
      onApp: !!t0.userId,
      venue: { name: v.name, area: v.area, city: v.city, address: v.address, lat: v.lat, lng: v.lng, mapUrl: v.mapUrl, format: v.format },
      tickets: list.map((t) => ({ leadId: t.id, code: t.code, day: t.day, start: t.start, end: t.end, pitch: t.pitch, amount: t.amount, url: t.url })),
      paid: list.reduce((n, t) => n + t.amount, 0),
      trxId: null,
      note: null,
      bookedAt: new Date(),
    };
    const m = playerEmail(mail);
    const attachments: Attachment[] = list.map((t) => ({
      filename: pdfName(t.code),
      url: `${t.url}/${pdfName(t.code)}`,
      content: () => pdfOf([t]),
    }));
    const out = { to, toName: t0.name, ...m, attachments };
    if (dry) emailsForTests.push({ ...out, kind: 'walkin', paymentId: t0.id });
    else await sendEmail(out);
    return true;
  } catch (e) {
    console.error(`[email] walk-in ticket for ${bookingIds[0]}: ${(e as Error).message}`);
    return false;
  }
}
