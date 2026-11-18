/**
 * Booking confirmation emails, sent once when an app booking is paid (payments.finalize):
 *  - the player: "Congratulations, your booking is confirmed", the details and the entry-pass QR;
 *  - the turf owner: "Congrats, you got a new booking", with the customer and session details.
 * Fire-and-forget: a failed email never affects the payment or the booking.
 * The QR is a hosted PNG (/v1/passes/:id/qr.png?s=…) of the same signed pass the app shows,
 * because Gmail and Outlook don't show inline data: images.
 */
import { config } from '../config';
import { one, q } from '../db';
import { emailEnabled, sendEmail } from '../lib/email';
import { addDays } from '../lib/time';
import { qrLinkSig } from '../lib/tokens';

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
  formats: string[] | null;
  owner_id: string | null;
};

export type Ticket = { leadId: string; code: string; day: string; start: number; end: number; pitch: string; amount: number };

export type BookingMail = {
  player: { name: string; phone: string; email: string | null };
  venue: { name: string; area: string; city: string; address: string; lat: number | null; lng: number | null; format: string };
  tickets: Ticket[];
  paid: number; // taka, what the player paid
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
type Mail = { to: string; toName?: string; subject: string; html: string; text: string };
/** Test servers (EMAIL_DRY_RUN): what would have been sent. */
export const emailsForTests: (Mail & { kind: 'player' | 'owner'; paymentId: string })[] = [];

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
              v.name as venue, v.area, v.city, v.address, v.lat, v.lng, v.formats, v.owner_id
         from bookings b join venues v on v.id = b.venue_id
        where ${p.order_id ? 'b.order_id = $1' : 'b.id = $1'} and b.status = 'confirmed'
        order by b.day, b.start_min`,
      [p.order_id ?? p.booking_id],
    );
    if (!rows.length) return;
    const user = await one<{ name: string; phone: string; email: string | null }>('select name, phone, email from users where id = $1', [p.user_id]);
    if (!user) return;
    const v = rows[0];
    const mail: BookingMail = {
      player: user,
      venue: { name: v.venue, area: v.area ?? '', city: v.city ?? '', address: v.address ?? '', lat: v.lat, lng: v.lng, format: v.formats?.[0] ?? '' },
      tickets: toTickets(rows),
      paid: Math.round(p.amount / 100),
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

// ── QR image link ────────────────────────────────────────────────────────────

export const qrUrl = (bookingId: string) => `${base()}/v1/passes/${bookingId}/qr.png?s=${qrLinkSig(bookingId)}`;

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
  v.lat != null && v.lng != null && (v.lat !== 0 || v.lng !== 0)
    ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address, place(v)].filter(Boolean).join(', '))}`;

// ── Layout pieces (tables + inline styles: the only layout every mail app agrees on) ──

const C = { ink: '#161B1D', dim: '#5C6468', faint: '#8A9196', line: '#E6E8E2', bg: '#F3F3EF', soft: '#F7F8F4', lime: '#DDF85C', limeSoft: '#F3FCCB', limeText: '#4E6B00' };
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Playfair Display',Georgia,'Times New Roman',serif";

function shell(o: { preheader: string; hero: string; heroAlt: string; body: string; footer: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
<title>TurfSides</title>
<style>
  @media (max-width:520px){ .px{padding-left:20px!important;padding-right:20px!important} .h1{font-size:28px!important;line-height:36px!important} .qr{width:104px!important;height:104px!important} .lbl{width:96px!important} .cardpad{padding-left:16px!important;padding-right:16px!important} .cap{letter-spacing:0.6px!important} .paidcol{width:104px!important} .amt{font-size:21px!important} .h2{font-size:20px!important;line-height:26px!important} }
  a{color:${C.ink}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${SANS};color:${C.ink};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 16px"><img src="${img('email-wordmark-dark.png')}" width="128" height="24" alt="TurfSides" style="display:block;border:0;height:24px;width:128px;font-size:18px;font-weight:800;color:${C.ink}"></td></tr>
<tr><td style="background:#FFFFFF;border-radius:28px;overflow:hidden;border:1px solid ${C.line}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:10px 10px 0"><img src="${img(o.hero)}" width="578" alt="${esc(o.heroAlt)}" style="display:block;width:100%;max-width:578px;height:auto;border:0;border-radius:20px;background:#EFF0EC"></td></tr>
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
<h1 class="h1" style="margin:0;font-family:${SERIF};font-weight:500;font-size:34px;line-height:42px;color:${C.ink};letter-spacing:-0.3px">${title}</h1>
<p style="margin:12px 0 0;font-size:16px;line-height:24px;color:${C.dim}">${sub}</p></td></tr>`;

const ticketLines = (t: Ticket[]) =>
  t.map((x) => `<div style="margin:0 0 2px">${esc(shortDay(x.day))} · ${esc(timeRange(x.start, x.end))}</div>`).join('');

const totalMinutes = (t: Ticket[]) => t.reduce((n, x) => n + (x.end - x.start), 0);

// ── Player ───────────────────────────────────────────────────────────────────

export function playerEmail(m: BookingMail) {
  const t0 = m.tickets[0];
  const many = m.tickets.length > 1;
  const v = m.venue;
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
    ['Paid', `${taka(m.paid)} <span style="color:${C.faint};font-weight:400">via bKash</span>`],
    ...(m.trxId ? [['Transaction ID', `<span style="font-family:Menlo,Consolas,monospace;font-size:13px">${esc(m.trxId)}</span>`] as [string, string]] : []),
    ...(m.note ? [['Your note', esc(m.note)] as [string, string]] : []),
  ];

  const body = `${headline(`Congratulations, ${esc(first(m.player.name))}!`, 'Your booking has been confirmed. See you on the pitch.')}
<tr><td class="px" style="padding:24px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:20px">
    <tr><td class="cardpad" style="padding:22px 22px 18px;border-bottom:1px solid ${C.line}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" style="padding-right:14px">
          <p class="cap" style="margin:0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.faint};font-weight:600;white-space:nowrap">Booking ${esc(t0.code)}</p>
          <p style="margin:8px 0 0;font-family:${SERIF};font-size:24px;line-height:30px;font-weight:600;color:${C.ink}">${esc(v.name)}</p>
          <p style="margin:4px 0 0;font-size:14px;color:${C.dim}">${esc(place(v))}</p>
          <p style="margin:14px 0 0"><span style="display:inline-block;white-space:nowrap;background:${C.limeSoft};color:${C.limeText};font-size:13px;font-weight:600;border-radius:999px;padding:6px 12px">${esc(when)}</span></p>
        </td>
        <td valign="top" align="right" style="width:128px">
          <img class="qr" src="${qrUrl(t0.leadId)}" width="128" height="128" alt="Entry pass QR for ${esc(t0.code)}" style="display:block;width:128px;height:128px;border:1px solid ${C.line};border-radius:14px;background:#FFFFFF">
          <p style="margin:6px 0 0;font-size:11px;color:${C.faint};text-align:center">Scan at the turf</p>
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
    <strong style="color:${C.ink}">At the turf:</strong> arrive 10 minutes early and show this QR, or the pass in the TurfSides app, at the front desk.${many ? ` Your ${m.tickets.length} time slots each have their own pass in the app.` : ''}
    Need to cancel? Open the booking in the app; the turf’s refund policy is shown there.
  </td></tr></table>
</td></tr>
<tr><td class="px" align="center" style="padding:30px 40px 36px">
  <p style="margin:0;font-family:${SERIF};font-size:20px;line-height:28px;color:${C.ink}">Thank you for using TurfSides.</p>
  <p style="margin:6px 0 0;font-size:14px;line-height:21px;color:${C.dim}">Have a great game. We’ll be here when you’re ready for the next one.</p>
</td></tr>`;

  const html = shell({
    preheader: `Your booking at ${v.name} is confirmed: ${longDay(t0.day)}, ${timeRange(t0.start, t0.end)}.`,
    hero: 'email-booking-player.png',
    heroAlt: 'Booking confirmed',
    body,
    footer: `You’re getting this because you booked on TurfSides with this email address.`,
  });

  const text = [
    `Congratulations, ${first(m.player.name)}! Your booking has been confirmed.`,
    '',
    `${v.name}${place(v) ? ` (${place(v)})` : ''}`,
    `Booking ${t0.code}`,
    ...m.tickets.map((x) => `${longDay(x.day)}, ${timeRange(x.start, x.end)}`),
    `Duration: ${duration(totalMinutes(m.tickets))}`,
    `Pitch: ${[t0.pitch, v.format].filter(Boolean).join(' · ')}`,
    `Address: ${fullAddress(v)}`,
    `Directions: ${mapsUrl(v)}`,
    `Paid: ${taka(m.paid)} via bKash${m.trxId ? ` (transaction ${m.trxId})` : ''}`,
    ...(m.note ? [`Your note: ${m.note}`] : []),
    '',
    'At the turf, show the entry pass QR in the TurfSides app (or in this email) at the front desk.',
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
    ['Booked', esc(dhakaStamp(m.bookedAt))],
    ...(m.note ? [['Customer note', esc(m.note)] as [string, string]] : []),
  ];

  const body = `${headline('Congrats, you got a new booking', `${esc(first(m.player.name))} booked ${esc(v.name)} in the TurfSides app. It’s paid, and the time is now closed to other players.`)}
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
    preheader: `${m.player.name} booked ${longDay(t0.day)}, ${timeRange(t0.start, t0.end)}. Paid ${taka(m.paid)}.`,
    hero: 'email-booking-owner.png',
    heroAlt: 'New booking',
    body,
    footer: `Sent to ${esc(first(ownerName))} as the owner of ${esc(v.name)}.`,
  });

  const text = [
    'Congrats, you got a new booking!',
    '',
    `${m.player.name} booked ${v.name} in the TurfSides app. It's paid, and the time is now closed to other players.`,
    '',
    `Customer: ${m.player.name}`,
    `Phone: ${phone}`,
    ...m.tickets.map((x) => `${longDay(x.day)}, ${timeRange(x.start, x.end)} (${x.code})`),
    `Duration: ${duration(totalMinutes(m.tickets))}`,
    `Pitch: ${[t0.pitch, v.format].filter(Boolean).join(' · ')}`,
    `Paid: ${taka(m.paid)} via bKash${m.trxId ? ` (transaction ${m.trxId})` : ''}`,
    `Booked: ${dhakaStamp(m.bookedAt)}`,
    ...(m.note ? [`Customer note: ${m.note}`] : []),
    '',
    'Thank you for hosting on TurfSides.',
  ].join('\n');

  return { subject, html, text };
}
