/**
 * The ticket as a PDF: the same white QR card the app shows when a player taps their entry pass
 * (turf name, date and time, the QR, the booking code and the reception note), one page per ticket.
 *
 * Built in memory on request and never written anywhere: satori lays the card out, resvg draws it,
 * and the pixels go into a minimal PDF (one Flate-compressed image per page). Pure JS/WASM, so it
 * runs on shared hosting like the share cards.
 */
import { Resvg } from '@resvg/resvg-wasm';
import { deflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import satori from 'satori';

import { brandFonts } from './og-card';

export type PdfTicket = {
  /** The turf's name (card title). */
  title: string;
  /** "Sat 21 · 8:00–9:00 PM" */
  subtitle: string;
  /** The booking code under the QR: "TS-261121-5130". */
  code: string;
  /** The signed entry pass the QR carries (the same value as in the app). */
  pass: string;
};

const INK = '#161B1D';
const DIM = '#5C6468';
const PAGE_BG = '#F3F3EF';

// Points (1/72 in). The card is the app's popup at phone size; the page adds a margin around it.
const CARD_W = 360;
const PAD = 20;
const QR_BOX = CARD_W - PAD * 2 - 8; // the QR with its white frame (6 pt each side in the app)
const MARGIN = 24;
const PAGE_W = CARD_W + MARGIN * 2;
const CARD_H = PAD + 40 + 16 + QR_BOX + 16 + 28 + 6 + 36 + PAD;
const PAGE_H = CARD_H + MARGIN * 2;
/** Pixels per point: 4 ≈ 288 dpi, sharp in print and on any screen. */
const SCALE = 4;

type El = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style: { display: 'flex', ...style }, children, ...extra },
});

/** The QR as one SVG path (module units) and its size, built like the app's QRCode component. */
export function qrPath(value: string) {
  const qr = QRCode.create(value, { errorCorrectionLevel: value.length > 120 ? 'L' : 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let d = '';
  for (let y = 0; y < n; y++) {
    let run = -1;
    for (let x = 0; x <= n; x++) {
      const on = x < n && data[y * n + x];
      if (on && run < 0) run = x;
      if (!on && run >= 0) {
        d += `M${run} ${y}h${x - run}v1h${run - x}z`;
        run = -1;
      }
    }
  }
  return { d, n };
}

/** A standalone SVG of the QR (2-module quiet zone), for web pages. */
export function qrSvgMarkup(value: string, size: number) {
  const { d, n } = qrPath(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Entry pass QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#FFFFFF"/><path d="${d}" fill="${INK}"/></svg>`;
}

function qrSvg(value: string, size: number): El {
  const { d, n } = qrPath(value);
  const pad = 2;
  return {
    type: 'svg',
    props: {
      width: size,
      height: size,
      viewBox: `${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`,
      children: { type: 'path', props: { d, fill: INK } },
    },
  };
}

function card(t: PdfTicket): El {
  const line = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  return h('div', { width: PAGE_W, height: PAGE_H, backgroundColor: PAGE_BG, alignItems: 'center', justifyContent: 'center', fontFamily: 'Geist' }, [
    h(
      'div',
      { width: CARD_W, height: CARD_H, backgroundColor: '#FFFFFF', borderRadius: 32, padding: PAD, flexDirection: 'column', alignItems: 'center' },
      [
        h('div', { flexDirection: 'column', alignSelf: 'stretch', height: 40 }, [
          h('div', { ...line, fontSize: 17, lineHeight: '22px', fontWeight: 700, color: INK }, t.title),
          h('div', { ...line, fontSize: 14, lineHeight: '18px', fontWeight: 500, color: DIM }, t.subtitle),
        ]),
        h('div', { marginTop: 16, padding: 6, backgroundColor: '#FFFFFF', borderRadius: 12 }, [qrSvg(t.pass, QR_BOX - 12)]),
        h('div', { marginTop: 16, fontSize: 22, lineHeight: '28px', fontWeight: 700, letterSpacing: 1, color: INK }, t.code),
        h(
          'div',
          { marginTop: 6, fontSize: 14, lineHeight: '18px', fontWeight: 500, color: DIM, textAlign: 'center', justifyContent: 'center' },
          'Show this at reception. Turn your screen brightness up if it won’t scan.',
        ),
      ],
    ),
  ]);
}

/** One page's pixels (RGB). */
async function renderPage(t: PdfTicket) {
  const fonts = await brandFonts();
  const svg = await satori(card(t) as never, { width: PAGE_W, height: PAGE_H, fonts });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: PAGE_W * SCALE }, background: PAGE_BG }).render();
  const { width, height } = r;
  const rgba = r.pixels;
  r.free();
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return { width, height, data: deflateSync(rgb, { level: 9 }) };
}

/** PDF strings: only plain ASCII, with the delimiters escaped. */
const pdfText = (s: string) => `(${s.replace(/[^\x20-\x7E]/g, '-').replace(/([()\\])/g, '\\$1')})`;

/** A PDF with one page per ticket, as a Buffer. Nothing is stored. */
export async function ticketPdf(tickets: PdfTicket[], title = 'TurfSides ticket'): Promise<Buffer> {
  if (!tickets.length) throw new Error('No tickets');
  const pages = [];
  for (const t of tickets) pages.push(await renderPage(t)); // one at a time: keeps memory low

  const objs: (string | Buffer)[][] = [];
  const add = (parts: (string | Buffer)[]) => objs.push(parts); // its object number
  const catalog = add([]); // filled below, once the page tree number is known
  const tree = add([]);
  const kids: number[] = [];
  for (const p of pages) {
    const img = add([
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${p.data.length} >>\nstream\n`,
      p.data,
      '\nendstream',
    ]);
    const draw = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`;
    const content = add([`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
    kids.push(
      add([
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`,
      ]),
    );
  }
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${tree} 0 R >>`];
  objs[tree - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`];
  const info = add([`<< /Title ${pdfText(title)} /Producer (TurfSides) >>`]);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objs.forEach((parts, i) => {
    offsets.push(offset);
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), ...parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)), Buffer.from('\nendobj\n')]);
    chunks.push(buf);
    offset += buf.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
