/**
 * The share card for a turf link: a 1200×630 JPEG that WhatsApp, Facebook, Messenger, X and others
 * show when someone shares turfsides.com/CODE. Turf photo, name, area, price, rating and the
 * TurfSides mark, so a shared turf looks like a proper post instead of a bare photo.
 *
 * Pure JavaScript/WebAssembly (satori → SVG, resvg → pixels, jpeg-js → JPEG): nothing native, so it
 * runs on shared hosting. JPEG because WhatsApp drops WebP and anything over ~600 KB.
 */
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import jpeg from 'jpeg-js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';

export const CARD_W = 1200;
export const CARD_H = 630;

export type CardInput = {
  name: string;
  place: string;
  formats: string[];
  /** The starting price as the app shows it: "From ৳1,800/hr" or "From ৳2,000 / 120 min". */
  price: string;
  rating: number;
  reviews: number;
  ref: string | null;
  /** The turf's photo (absolute URL), or null for the plain brand background. */
  photo: string | null;
  /** Optional overrides (match cards): the lime line above the name, the top-right label, a plain
   *  pill shown instead of the rating, and the call to action. */
  eyebrow?: string;
  badge?: string | null;
  chip?: string | null;
  cta?: string;
};

// public/og next to dist/ when bundled; two levels up from src/lib when run from source.
const dir = () => [join(__dirname, '..', 'public', 'og'), join(__dirname, '..', '..', 'public', 'og')].find((d) => existsSync(d)) ?? join(__dirname, '..', 'public', 'og');

let ready: Promise<{ fonts: Parameters<typeof satori>[1]['fonts'] }> | null = null;
function setup() {
  ready ??= (async () => {
    const [wasm, webp, bold, medium, taka] = await Promise.all(
      ['resvg.wasm', 'webp_dec.wasm', 'Geist-Bold.ttf', 'Geist-Medium.ttf', 'Taka-Bold.ttf'].map((f) => readFile(join(dir(), f))),
    );
    await initWasm(wasm!);
    // Turf photos are WebP, which the renderer can't read: decode them ourselves.
    await initWebp(await WebAssembly.compile(webp!));
    return {
      fonts: [
        { name: 'Geist', data: bold!, weight: 700 as const, style: 'normal' as const },
        { name: 'Geist', data: medium!, weight: 500 as const, style: 'normal' as const },
        // The ৳ sign isn't in Geist; this tiny font carries it.
        { name: 'Taka', data: taka!, weight: 700 as const, style: 'normal' as const },
      ],
    };
  })().catch((e) => {
    ready = null; // try again next time
    throw e;
  });
  return ready;
}

/** The photo as a data URL (satori can't fetch). Null if it can't be had quickly. */
async function photoData(url: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0] || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    const isWebp = type === 'image/webp' || (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
    if (isWebp) {
      const img = await decodeWebp(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      const jpg = jpeg.encode({ data: Buffer.from(img.data.buffer), width: img.width, height: img.height }, 88);
      return `data:image/jpeg;base64,${Buffer.from(jpg.data).toString('base64')}`;
    }
    return `data:${type || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// satori takes React-like element objects; plain objects keep this file free of JSX.
type El = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style: { display: 'flex', ...style }, children, ...extra },
});

const LIME = '#DDF65A';
/** A filled star (not in the font). */
const star = (): El => ({
  type: 'svg',
  props: {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    children: { type: 'path', props: { fill: '#F5B83D', d: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z' } },
  },
});
const INK = '#0E1213';

function card(c: CardInput, photo: string | null): El {
  // The ৳ sign comes from its own font; everything else from Geist.
  const price = c.price.split('৳').flatMap((part, i) => [...(i ? [h('span', { fontFamily: 'Taka' }, '৳')] : []), ...(part ? [h('span', { whiteSpace: 'pre' }, part)] : [])]);
  const eyebrow = (c.eyebrow ?? ['Football', ...(c.formats.length ? [c.formats.join(' / ')] : [])].join(' · ')).toUpperCase();
  const badge = c.badge !== undefined ? c.badge : c.ref ? `Turf ID ${c.ref}` : null;
  const pill = { alignItems: 'center', fontSize: 26, fontWeight: 700, padding: '12px 22px', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' };
  return h(
    'div',
    { width: CARD_W, height: CARD_H, position: 'relative', backgroundColor: INK, fontFamily: 'Geist', color: '#FFFFFF' },
    [
      photo
        ? h('img', { position: 'absolute', left: 0, top: 0, width: CARD_W, height: CARD_H, objectFit: 'cover' }, undefined, { src: photo, width: CARD_W, height: CARD_H })
        : h('div', { position: 'absolute', left: 0, top: 0, width: CARD_W, height: CARD_H, backgroundImage: 'linear-gradient(135deg, #1B2A12 0%, #0E1213 70%)' }),
      // Shade: readable text over any photo, darkest at the bottom left.
      h('div', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: CARD_W,
        height: CARD_H,
        backgroundImage: 'linear-gradient(180deg, rgba(14,18,19,0.55) 0%, rgba(14,18,19,0.05) 30%, rgba(14,18,19,0.55) 58%, rgba(14,18,19,0.96) 100%)',
      }),
      // Top: brand on the left, turf ID on the right.
      h('div', { position: 'absolute', left: 56, right: 56, top: 48, justifyContent: 'space-between', alignItems: 'center' }, [
        h('div', { alignItems: 'center', gap: 12 }, [
          h('div', { width: 22, height: 22, borderRadius: 11, backgroundColor: LIME }),
          h('div', { fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }, 'TurfSides'),
        ]),
        badge
          ? h(
              'div',
              { fontSize: 22, fontWeight: 500, padding: '10px 18px', borderRadius: 999, backgroundColor: 'rgba(14,18,19,0.55)', border: '1px solid rgba(255,255,255,0.22)' },
              badge,
            )
          : h('div', {}),
      ]),
      // Bottom: what the turf is, then price and rating.
      h('div', { position: 'absolute', left: 56, right: 56, bottom: 52, flexDirection: 'column' }, [
        h('div', { fontSize: 20, fontWeight: 700, letterSpacing: 4, color: LIME }, eyebrow),
        h('div', { fontSize: c.name.length > 26 ? 56 : 68, fontWeight: 700, lineHeight: 1.05, marginTop: 14, letterSpacing: -1.5 }, c.name),
        h('div', { fontSize: 28, fontWeight: 500, color: 'rgba(255,255,255,0.82)', marginTop: 12 }, c.place),
        h('div', { marginTop: 28, alignItems: 'center', gap: 14 }, [
          h('div', { alignItems: 'center', fontSize: 28, fontWeight: 700, color: INK, backgroundColor: LIME, padding: '12px 24px', borderRadius: 999 }, price),
          c.chip
            ? h('div', pill, c.chip)
            : c.rating > 0
              ? h('div', pill, [star(), h('span', { marginLeft: 10 }, `${c.rating.toFixed(1)}${c.reviews ? `  (${c.reviews})` : ''}`)])
              : h('div', {}),
          h('div', { flex: 1 }),
          h('div', { fontSize: 24, fontWeight: 500, color: 'rgba(255,255,255,0.75)' }, c.cta ?? 'Book on TurfSides →'),
        ]),
      ]),
    ],
  );
}

/** Render the card as a JPEG (about 80–200 KB). */
export async function renderCard(c: CardInput): Promise<Buffer> {
  const { fonts } = await setup();
  const photo = await photoData(c.photo);
  const draw = async (img: string | null) => {
    const svg = await satori(card(c, img) as never, { width: CARD_W, height: CARD_H, fonts });
    return new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render();
  };
  // A photo the renderer can't decode: still make the card, on the brand background.
  const r = await draw(photo).catch(() => draw(null));
  const out = jpeg.encode({ data: Buffer.from(r.pixels), width: r.width, height: r.height }, 82);
  r.free();
  return Buffer.from(out.data);
}
