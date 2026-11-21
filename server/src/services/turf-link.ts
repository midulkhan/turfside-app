/**
 * Turf share links: turfsides.com/FDJV346.
 *
 * With the app installed (and the link verified for turfsides.com), tapping the link opens the turf
 * in the app directly; this page is never seen. Otherwise turfsides.com forwards here
 * (api.turfsides.com/t/FDJV346): a light page with the turf, an "Open in the app" button and the
 * store links. It also carries the Open Graph tags that WhatsApp, Messenger and others read for the
 * link preview (photo, name, area, price).
 */
import { createHash } from 'node:crypto';
import { config } from '../config';
import { renderCard } from '../lib/og-card';
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

type Linked = Row & { from: string };

/** What the card shows; its hash goes in the image URL so apps re-fetch when it changes. */
const cardInput = (v: Linked) => ({
  name: v.name,
  place: [v.area, v.city].filter(Boolean).join(', '),
  formats: v.formats ?? [],
  price: v.from,
  rating: Number(v.rating) || 0,
  reviews: v.review_count ?? 0,
  ref: refLabel(v.ref_no),
  photo: v.photo ? photoUrl(v.photo) : null,
});
const cardVersion = (v: Linked) => createHash('sha1').update(JSON.stringify(cardInput(v))).digest('hex').slice(0, 10);
/** The share card's URL (absolute: link-preview bots need that). */
export const cardUrl = (v: Linked) => `${config.PUBLIC_URL.replace(/\/+$/, '')}/t/${v.short_code}/card.jpg?v=${cardVersion(v)}`;

// Recent cards in memory (a shared link is fetched by many previews at once). Small: ~100 KB each.
const cards = new Map<string, Buffer>();
/** The share card JPEG for a turf, rendered once per version. */
export async function turfCard(v: Linked) {
  const key = `${v.short_code}:${cardVersion(v)}`;
  const hit = cards.get(key);
  if (hit) return hit;
  const jpg = await renderCard(cardInput(v));
  cards.set(key, jpg);
  if (cards.size > 40) cards.delete(cards.keys().next().value!);
  return jpg;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PLAY = 'https://play.google.com/store/apps/details?id=app.turfsides';

/** Content-Security-Policy for the page: our inline styles/script, images from anywhere https, app links. */
export const PAGE_CSP =
  "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const taka = (poisha: number) => Math.round(poisha / 100).toLocaleString('en-IN');
/** "From ৳2,000 / 120 min" (custom sessions, always in minutes) or "From ৳1,800/hr". */
export const fromLabel = (p: ReturnType<typeof startingPrice>) =>
  p.per === 'session' && p.minutes !== 60 ? `From ৳${taka(p.amount)} / ${p.minutes} min` : `From ৳${taka(p.amount)}/hr`;

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
  const intent = `intent://t/${v.short_code}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=app.turfsides;S.browser_fallback_url=${encodeURIComponent(android ?? PLAY)};end`;

  const stores = [
    android ? `<a class="store" href="${esc(android)}">Get it on Google Play</a>` : `<span class="store off">Google Play · coming soon</span>`,
    ios ? `<a class="store" href="${esc(ios)}">Download on the App Store</a>` : `<span class="store off">App Store · coming soon</span>`,
  ].join('');

  return {
    status: 200,
    html: shell({
      title: `${v.name} · TurfSides`,
      og: {
        title: `${v.name} · ${place}`,
        description: `${facts.join(' · ')}. ${refLabel(v.ref_no) ? `Turf ID ${refLabel(v.ref_no)}. ` : ''}See times and book on TurfSides.`,
        image: cardUrl(v),
        imageAlt: `${v.name}, ${place}. ${v.from} on TurfSides.`,
        card: true,
        url: shareUrl(v.short_code)!,
      },
      body: `<main class="card">
  <div class="photo" style="background-image:url('${esc(photo)}')"></div>
  <div class="pad">
    <p class="ref">${esc(refLabel(v.ref_no) ?? '')}</p>
    <h1>${esc(v.name)}</h1>
    <p class="place">${esc(place)}</p>
    <p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
    <a class="btn" id="open" href="${esc(deep)}" data-intent="${esc(intent)}">Open in the TurfSides app</a>
    <p class="note" id="note">See times, prices and book in the app.</p>
    <div class="stores">${stores}</div>
  </div>
</main>
<script>
  // Android browsers: use the intent link, which falls back to the store if the app isn't installed.
  (function () {
    var a = document.getElementById('open');
    var ua = navigator.userAgent;
    if (/Android/i.test(ua)) a.href = a.getAttribute('data-intent');
    // Facebook, Instagram, Messenger and other in-app browsers often refuse to open apps.
    if (/FBAN|FBAV|FB_IAB|Instagram|Messenger|Line[/]|; wv[)]/i.test(ua)) {
      document.getElementById('note').textContent = "If the app doesn't open, tap ⋮ and choose Open in browser, then tap the button again.";
    }
  })();
</script>`,
    }),
  };
}

function shell(o: { title: string; og: { title: string; description: string; image: string; url: string; imageAlt?: string; card?: boolean }; body: string }) {
  // The generated card is a 1200×630 JPEG; saying so lets apps lay out the big preview straight away.
  const card = o.og.card
    ? `<meta property="og:image:secure_url" content="${esc(o.og.image)}"><meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(o.og.imageAlt ?? o.og.title)}"><meta name="twitter:image:alt" content="${esc(o.og.imageAlt ?? o.og.title)}">`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.og.description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="TurfSides">
<meta property="og:title" content="${esc(o.og.title)}"><meta property="og:description" content="${esc(o.og.description)}">
<meta property="og:image" content="${esc(o.og.image)}"><meta property="og:url" content="${esc(o.og.url)}">
${card}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.og.title)}">
<meta name="twitter:description" content="${esc(o.og.description)}"><meta name="twitter:image" content="${esc(o.og.image)}">
<meta property="og:locale" content="en_US"><meta name="robots" content="noindex">
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
