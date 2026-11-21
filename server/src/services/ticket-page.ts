/**
 * The ticket page behind a ticket link (api.turfsides.com/ticket/<token>): the same white QR card as
 * the app, the session details, directions and a PDF download. Read-only, never indexed, and it
 * sends no referrer, so the link doesn't leak to the maps or app-store pages it links to.
 */
import { config } from '../config';
import { qrSvgMarkup } from '../lib/ticket-pdf';

import { appRange, appSubtitle, pdfName, type TicketView } from './tickets';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const taka = (n: number) => `৳${n.toLocaleString('en-IN')}`;
const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const duration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h} hour${h > 1 ? 's' : ''}` : `${m} min`;
};
const place = (v: TicketView['venue']) => [v.area, v.city].filter(Boolean).join(', ');
const directions = (v: TicketView['venue']) =>
  v.mapUrl ||
  (v.lat != null && v.lng != null && (v.lat !== 0 || v.lng !== 0)
    ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address, place(v)].filter(Boolean).join(', '))}`);

/** Page headers: no caching anywhere, no indexing, no referrer, our inline styles only. */
export const TICKET_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function shell(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#F3F3EF">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:flex;justify-content:center;padding:24px 16px 40px;background:#F3F3EF;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161B1D;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:400px} .logo{display:block;margin:0 auto 18px;height:22px}
  .qr{background:#fff;border-radius:32px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px}
  .head{align-self:stretch;min-width:0} .t{margin:0;font-size:17px;line-height:22px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .s{margin:0;font-size:14px;line-height:18px;font-weight:500;color:#5C6468}
  .code-box{background:#fff;border-radius:12px;padding:6px;width:100%;max-width:312px} .code-box svg{display:block;width:100%;height:auto}
  .foot{text-align:center} .code{margin:0;font-size:22px;line-height:28px;font-weight:700;letter-spacing:1px}
  .hint{margin:6px 0 0;font-size:14px;line-height:18px;font-weight:500;color:#5C6468}
  .void{width:100%;border-radius:16px;background:#F3F3EF;padding:28px 18px;text-align:center;color:#5C6468;font-size:15px;line-height:21px}
  .void b{display:block;color:#161B1D;font-size:17px;margin-bottom:4px}
  .card{margin-top:14px;background:#fff;border-radius:24px;padding:6px 20px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid #E6E8E2;font-size:14px;line-height:20px}
  .row:last-child{border-bottom:0} .row span:first-child{color:#8A9196} .row span:last-child{text-align:right;font-weight:500}
  .pill{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
  .ok{background:#F3FCCB;color:#4E6B00} .no{background:#FDE8E6;color:#B42318} .done{background:#ECEEE8;color:#5C6468}
  .btns{display:grid;gap:10px;margin-top:14px}
  .btn{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:15px;padding:14px;border-radius:14px}
  .dark{background:#161B1D;color:#fff} .light{background:#fff;color:#161B1D;border:1px solid #E6E8E2}
  .small{margin:18px 0 0;text-align:center;font-size:12px;line-height:18px;color:#8A9196}
</style></head><body><div class="wrap"><img class="logo" src="${config.PUBLIC_URL}/static/brand/email-wordmark-dark.png" alt="TurfSides">${body}</div></body></html>`;
}

export function ticketPage(t: (TicketView & { url: string }) | null) {
  if (!t) {
    return {
      status: 404,
      html: shell(
        'Ticket not found · TurfSides',
        `<div class="qr"><div class="void"><b>This ticket link isn’t valid</b>Check that you opened the full link from your email.</div></div>`,
      ),
    };
  }
  const v = t.venue;
  const state =
    t.status === 'cancelled'
      ? { pill: '<span class="pill no">Cancelled</span>', note: '<b>This booking was cancelled</b>This ticket can’t be used.' }
      : t.status === 'completed'
        ? { pill: '<span class="pill done">Played</span>', note: '<b>This game has finished</b>Thanks for playing on TurfSides.' }
        : t.status === 'checked_in'
          ? { pill: '<span class="pill ok">Checked in</span>', note: '' }
          : { pill: '<span class="pill ok">Confirmed</span>', note: '' };
  const qr = t.pass
    ? `<div class="code-box">${qrSvgMarkup(t.pass, 300)}</div>
<div class="foot"><p class="code">${esc(t.code)}</p><p class="hint">Show this at reception. Turn your screen brightness up if it won’t scan.</p></div>`
    : `<div class="void">${state.note}</div><div class="foot"><p class="code">${esc(t.code)}</p></div>`;
  const rows: [string, string][] = [
    ['Status', state.pill],
    ['Turf', `${esc(v.name)}${place(v) ? `<br><span style="color:#5C6468;font-weight:400">${esc(place(v))}</span>` : ''}`],
    ['Date', esc(longDay(t.day))],
    ['Time', esc(appRange(t.start, t.end))],
    ['Duration', esc(duration(t.end - t.start))],
    ['Pitch', esc([t.pitch, v.format].filter(Boolean).join(' · '))],
    ['Booked for', esc(t.name)],
    [t.source === 'walkin' ? 'Amount' : 'Paid', `${taka(t.amount)}${t.source === 'walkin' ? '' : ' <span style="color:#8A9196;font-weight:400">via bKash</span>'}`],
  ];
  const html = shell(
    `${t.code} · ${v.name} · TurfSides`,
    `<div class="qr"><div class="head"><p class="t">${esc(v.name)}</p><p class="s">${esc(appSubtitle(t))}</p></div>${qr}</div>
<div class="card">${rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('')}</div>
<div class="btns">
  ${t.pass ? `<a class="btn dark" href="${esc(t.url)}/${esc(pdfName(t.code))}" download>Download ticket (PDF)</a>` : ''}
  ${t.status === 'confirmed' ? `<a class="btn light" href="${esc(directions(v))}" target="_blank" rel="noopener noreferrer">Get directions</a>` : ''}
</div>
<p class="small">Keep this link to yourself: anyone who has it can see this ticket.</p>`,
  );
  return { status: 200, html };
}
