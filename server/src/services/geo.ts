/**
 * Turn a Google Maps link (or pasted coordinates) into an exact point, for the owner's map picker.
 * Free: no Google API. Short links (maps.app.goo.gl) are followed hop by hop, only ever to Google
 * hosts (never an arbitrary URL from the request), then the pin is read from the final URL; if the
 * URL has no coordinates, the place page is read for them.
 */
import { ApiError } from '../errors';

export type Point = { lat: number; lng: number; name?: string };

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const ok = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const pt = (lat: number, lng: number, name?: string): Point | null => (ok(lat, lng) ? { lat: round(lat), lng: round(lng), ...(name ? { name } : {}) } : null);

/** "23.84, 90.25", "23.84,90.25", "23.845° N, 90.257° E", "23°50'42.0"N 90°15'25.2"E". */
export function coordsFromText(s: string): Point | null {
  const t = s.trim();
  // Degrees, minutes, seconds (what Google shows when you tap a dropped pin).
  const dms = /(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)(?:"|″|'')?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)(?:"|″|'')?\s*([EW])/i.exec(t);
  if (dms) {
    const lat = (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) * (/s/i.test(dms[4]!) ? -1 : 1);
    const lng = (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) * (/w/i.test(dms[8]!) ? -1 : 1);
    return pt(lat, lng);
  }
  const deg = /^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i.exec(t);
  if (deg) {
    const lat = Number(deg[1]) * (deg[2] && /s/i.test(deg[2]) ? -1 : 1);
    const lng = Number(deg[3]) * (deg[4] && /w/i.test(deg[4]) ? -1 : 1);
    return pt(lat, lng);
  }
  return null;
}

/** Reads a Google Maps URL: the place pin (!3d…!4d…) first, then ?q=/query=/ll=, then the @view. */
export function coordsFromMapsUrl(raw: string): Point | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const full = decodeURIComponent(u.pathname + u.search + u.hash).replace(/\+/g, ' ');
  const name = /\/place\/([^/@]+)/.exec(full)?.[1]?.trim();
  const placeName = name && !coordsFromText(name) ? name : undefined;

  const pin = new RegExp(String.raw`!3d${NUM}!4d${NUM}`).exec(full);
  if (pin) return pt(Number(pin[1]), Number(pin[2]), placeName);

  for (const k of ['q', 'query', 'll', 'sll', 'center', 'destination', 'daddr', 'cbll']) {
    const v = u.searchParams.get(k);
    if (!v) continue;
    const c = coordsFromText(v.replace(/^loc:/i, '').split('(')[0]!);
    if (c) return c;
  }
  const inPath = new RegExp(String.raw`/(?:place|search|dir/[^/]*)/${NUM},\s*${NUM}`).exec(full);
  if (inPath) return pt(Number(inPath[1]), Number(inPath[2]), placeName);
  const view = new RegExp(String.raw`@${NUM},${NUM}`).exec(full);
  if (view) return pt(Number(view[1]), Number(view[2]), placeName);
  return null;
}

/** Only Google Maps hosts are ever fetched. */
export function isGoogleMapsHost(host: string) {
  const h = host.toLowerCase();
  return (
    h === 'maps.app.goo.gl' ||
    h === 'goo.gl' ||
    h === 'g.co' ||
    /^(www\.|maps\.)?google\.(com|[a-z]{2,3}|com?\.[a-z]{2})$/.test(h) ||
    h === 'consent.google.com'
  );
}

/** Coordinates inside a Google place page (static-map preview, canonical link, or app state). */
export function coordsFromHtml(html: string): Point | null {
  const tries = [
    new RegExp(String.raw`center=${NUM}(?:%2C|,)${NUM}`),
    new RegExp(String.raw`markers=${NUM}(?:%2C|,)${NUM}`),
    new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
    new RegExp(String.raw`/@${NUM},${NUM},`),
    new RegExp(String.raw`\[null,null,${NUM},${NUM}\]`),
  ];
  for (const re of tries) {
    const m = re.exec(html);
    const p = m && pt(Number(m[1]), Number(m[2]));
    if (p) return p;
  }
  return null;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(url: string) {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'CONSENT=YES+1' },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

/** Pasted text from the owner: coordinates, or anything containing a Google Maps link. */
export async function resolveLocation(input: string): Promise<Point> {
  const text = input.trim().slice(0, 2000);
  const direct = coordsFromText(text);
  if (direct) return direct;

  const link = /https?:\/\/[^\s<>"']+/i.exec(text)?.[0];
  if (!link) throw new ApiError('invalid', 'Paste a Google Maps link or coordinates like 23.84, 90.25.');
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ApiError('invalid', 'That link doesn’t look right.');
  }
  if (!isGoogleMapsHost(url.hostname)) throw new ApiError('invalid', 'Use a Google Maps link (Share → Copy link in Google Maps).');

  let name: string | undefined;
  for (let hop = 0; hop < 6; hop++) {
    const found = coordsFromMapsUrl(url.toString());
    if (found) return { ...found, name: found.name ?? name };
    // Consent / interstitial pages carry the real URL in ?continue=.
    const cont = url.searchParams.get('continue');
    if (cont) {
      try {
        const next = new URL(cont);
        if (isGoogleMapsHost(next.hostname)) {
          url = next;
          continue;
        }
      } catch {
        /* fall through */
      }
    }
    name ??= /\/place\/([^/@]+)/.exec(decodeURIComponent(url.pathname).replace(/\+/g, ' '))?.[1];
    const res = await get(url.toString());
    if (!res) throw new ApiError('internal', 'Couldn’t reach Google Maps. Try again, or drop the pin on the map.');
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, url);
      if (!isGoogleMapsHost(next.hostname)) break;
      url = next;
      continue;
    }
    if (res.ok) {
      const html = (await res.text().catch(() => '')).slice(0, 3_000_000);
      const p = coordsFromHtml(html);
      if (p) return { ...p, name };
    }
    break;
  }
  throw new ApiError('invalid', 'That link has no exact location. In Google Maps, open the turf itself, tap Share → Copy link, and paste it here.');
}
