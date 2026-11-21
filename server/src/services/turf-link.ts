/**
 * Turf share links: turfsides.com/FDJV346.
 *
 * With the app installed (and the link verified for turfsides.com), tapping the link opens the turf
 * in the app directly; this page is never seen. Otherwise turfsides.com forwards here
 * (api.turfsides.com/t/FDJV346): a light page with the turf, an "Open in the app" button and the
 * store links. It also carries the Open Graph tags that WhatsApp, Messenger and others read for the
 * link preview (photo, name, area, price).
 */
import { config } from '../config';
import { one } from '../db';
import { getVenueRow, photoUrl, refLabel, SHORT_CODE, shareUrl, startingPrice } from './venues';

type Row = {
  id: string;
  name: string;
  area: string;
  city: string;
  rating: string;
  review_count: number;
  formats: string[];
  short_code: string;
  ref_no: number;
  photo: string | null;
  hourly: number;
};

/** The turf behind a short code, if it's listed. Codes are matched case-insensitively. */
export async function venueByCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (!SHORT_CODE.test(code)) return null;
  const v = await one<Row>(
    `select v.id, v.name, v.area, v.city, v.rating, v.review_count, v.formats, v.short_code, v.ref_no, p.standard_hourly as hourly,
            (select url from venue_photos ph where ph.venue_id = v.id order by position limit 1) as photo
       from venues v join venue_pricing p on p.venue_id = v.id
      where v.short_code = $1 and v.status = 'published'`,
    [code],
  );
  if (!v) return null;
  // "From …": the same rule as the app (startingPrice), not just the standard rate.
  const row = await getVenueRow(v.id).catch(() => null);
  return { ...v, from: row ? fromLabel(startingPrice(row)) : `From ৳${taka(v.hourly)}/hr` };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PLAY = 'https://play.google.com/store/apps/details?id=app.turfsides';

/** Content-Security-Policy for the page: our inline styles/script, images from anywhere https, app links. */
export const PAGE_CSP =
  "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const taka = (poisha: number) => Math.round(poisha / 100).toLocaleString('en-IN');
const hours = (min: number) => (min % 60 === 0 ? `${min / 60} hr` : min > 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`);
/** "From ৳2,000 · 2 hr session" (custom sessions) or "From ৳1,800/hr". */
export const fromLabel = (p: ReturnType<typeof startingPrice>) =>
  p.per === 'session' ? `From ৳${taka(p.amount)} · ${hours(p.minutes)} session` : `From ৳${taka(p.amount)}/hr`;

export function turfPage(v: (Row & { from: string }) | null, code: string) {
  const scheme = config.APP_SCHEME;
  const android = config.ANDROID_STORE_URL ?? null;
  const ios = config.IOS_STORE_URL ?? null;
  const site = config.SITE_URL.replace(/\/+$/, '');

  if (!v) {
    return {
      status: 404,
      html: shell({
        title: 'Turf not found · TurfSides',
        og: { title: 'TurfSides', description: 'Book a turf. Find your squad.', image: `${config.PUBLIC_URL}/static/brand/og-default.png`, url: site },
        body: `<main class="card empty"><h1>This turf link isn’t active</h1><p>The turf may have been removed or the link mistyped.</p>
<a class="btn" href="${site}">Go to TurfSides</a></main>`,
      }),
    };
  }

  const photo = v.photo ? photoUrl(v.photo) : `${config.PUBLIC_URL}/static/brand/og-default.png`;
  const place = [v.area, v.city].filter(Boolean).join(', ');
  const rating = Number(v.rating);
  const facts = [
    rating > 0 ? `★ ${rating.toFixed(1)} (${v.review_count})` : null,
    v.formats?.length ? v.formats.join(' · ') : null,
    v.from,
  ].filter(Boolean) as string[];
  const deep = `${scheme}://t/${v.short_code}`;
  // Android: an intent link opens the app if it's installed, otherwise the store page.
  const intent = `intent://t/${v.short_code}#Intent;scheme=${scheme};package=app.turfsides;S.browser_fallback_url=${encodeURIComponent(android ?? PLAY)};end`;

  const stores = [
    android ? `<a class="store" href="${esc(android)}">Get it on Google Play</a>` : `<span class="store off">Google Play · coming soon</span>`,
    ios ? `<a class="store" href="${esc(ios)}">Download on the App Store</a>` : `<span class="store off">App Store · coming soon</span>`,
  ].join('');

  return {
    status: 200,
    html: shell({
      title: `${v.name} · TurfSides`,
      og: { title: `${v.name} · ${place}`, description: `${facts.join(' · ')}. Book it on TurfSides.`, image: photo, url: shareUrl(v.short_code)! },
      body: `<main class="card">
  <div class="photo" style="background-image:url('${esc(photo)}')"></div>
  <div class="pad">
    <p class="ref">${esc(refLabel(v.ref_no) ?? '')}</p>
    <h1>${esc(v.name)}</h1>
    <p class="place">${esc(place)}</p>
    <p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
    <a class="btn" id="open" href="${esc(deep)}" data-intent="${esc(intent)}">Open in the TurfSides app</a>
    <p class="note">See times, prices and book in the app.</p>
    <div class="stores">${stores}</div>
  </div>
</main>
<script>
  // Android browsers: use the intent link, which falls back to the store if the app isn't installed.
  (function () {
    var a = document.getElementById('open');
    if (/Android/i.test(navigator.userAgent)) a.href = a.getAttribute('data-intent');
  })();
</script>`,
    }),
  };
}

function shell(o: { title: string; og: { title: string; description: string; image: string; url: string }; body: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.og.description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="TurfSides">
<meta property="og:title" content="${esc(o.og.title)}"><meta property="og:description" content="${esc(o.og.description)}">
<meta property="og:image" content="${esc(o.og.image)}"><meta property="og:url" content="${esc(o.og.url)}">
<meta name="twitter:card" content="summary_large_image"><meta name="robots" content="noindex">
<meta name="theme-color" content="#F3F3EF">
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#F3F3EF;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161B1D;-webkit-font-smoothing:antialiased}
  .card{width:100%;max-width:420px;background:#fff;border:1px solid #E6E8E2;border-radius:24px;overflow:hidden}
  .photo{aspect-ratio:16/10;background:#E6E8E2 center/cover no-repeat}
  .pad{padding:22px 22px 24px} .ref{margin:0;font-size:12px;letter-spacing:1.2px;color:#8A9196;font-weight:600}
  h1{margin:6px 0 2px;font-size:24px;line-height:30px} .place{margin:0;color:#5C6468;font-size:15px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0;padding:0} .facts span{background:#F3F3EF;border-radius:999px;padding:5px 10px;font-size:13px;color:#3C4449}
  .btn{display:block;margin-top:20px;background:#161B1D;color:#fff;text-align:center;text-decoration:none;font-weight:600;font-size:16px;padding:14px;border-radius:14px}
  .btn:active{opacity:.85} .note{margin:10px 0 0;text-align:center;font-size:13px;color:#8A9196}
  .stores{display:grid;gap:8px;margin-top:18px;border-top:1px solid #E6E8E2;padding-top:18px}
  .store{display:block;text-align:center;border:1px solid #E6E8E2;border-radius:12px;padding:11px;font-size:14px;font-weight:600;color:#161B1D;text-decoration:none}
  .store.off{color:#8A9196;font-weight:500}
  .empty{padding:28px;text-align:center} .empty p{color:#5C6468}
  .logo{display:block;margin:0 auto 16px;height:22px}
</style></head>
<body><div style="width:100%;max-width:420px"><img class="logo" src="${config.PUBLIC_URL}/static/brand/email-wordmark-dark.png" alt="TurfSides">${o.body}</div></body></html>`;
}
