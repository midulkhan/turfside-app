/**
 * Share links for player and opponent requests: turfsides.com/K7QM2XP (same format as turf links,
 * one shared pool of codes). With the app installed the link opens the request in the app;
 * otherwise turfsides.com forwards to /t/:code here, which shows a light page with the match, an
 * "Open in the app" button and the Open Graph tags for the link preview (a branded card).
 *
 * Public on purpose, so only what the in-app feed already shows to anyone: title or team names,
 * turf, date and time, format, level, spots left and the price. Never names or phone numbers of
 * players.
 */
import { createHash } from 'node:crypto';

import { config } from '../config';
import { renderCard, type CardInput } from '../lib/og-card';
import type { MatchOut } from './matches';
import { esc, openInApp, shell } from './turf-link';

type Linked = MatchOut;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** "Sat 21 Nov · 10:00 AM–12:00 PM" (Dhaka dates, as the app shows them). */
export function whenLabel(m: Pick<Linked, 'day' | 'start' | 'end'>) {
  const d = new Date(`${m.day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${clock(m.start)}–${clock(m.end)}`;
}
const taka = (poisha: number) => `৳${Math.round(poisha / 100).toLocaleString('en-IN')}`;
const versus = (format: string) => {
  const n = /^(\d+)-a-side$/.exec(format)?.[1];
  return n ? `${n} v ${n}` : format;
};
const levelLabel = (l: string) => l.charAt(0).toUpperCase() + l.slice(1);
const opponentPost = (m: Linked) => m.type === 'opponent';

/** "Bangu Squad vs Seeds" once an opponent has paid; the default "… vs ?" otherwise. */
export function matchName(m: Linked) {
  const opp = 'opponent' in m ? m.opponent : null;
  return opponentPost(m) && opp && /\bvs \?$/.test(m.title) ? m.title.replace(/\?$/, opp.teamName) : m.title;
}

/** Where the request stands, in a few words. */
function status(m: Linked) {
  const past = Date.parse(`${m.day}T00:00:00+06:00`) + m.end * 60_000 < Date.now();
  if (past) return { open: false, label: 'This game has been played' };
  if (m.status === 'paused') return { open: false, label: 'Not taking requests right now' };
  if (opponentPost(m)) {
    const found = 'opponent' in m && !!m.opponent;
    return found || m.spotsLeft === 0 ? { open: false, label: 'Opponent found' } : { open: m.status === 'open', label: 'Opponent wanted' };
  }
  if (m.spotsLeft <= 0 || m.status !== 'open') return { open: false, label: 'Squad full' };
  return { open: true, label: m.spotsLeft === 1 ? '1 spot left' : `${m.spotsLeft} spots left` };
}

const priceLabel = (m: Linked) => (opponentPost(m) ? `${taka(m.share)} per team` : `${taka(m.share)} per player`);
const place = (m: Linked) => [m.venue.name, m.venue.area].filter(Boolean).join(', ');

/** What the card shows; its hash goes in the image URL so previews re-fetch when it changes. */
const cardInput = (m: Linked): CardInput => ({
  name: matchName(m),
  place: place(m),
  formats: [],
  eyebrow: [opponentPost(m) ? 'Team vs team' : 'Players wanted', versus(m.format), levelLabel(m.level)].join(' · '),
  price: priceLabel(m),
  rating: 0,
  reviews: 0,
  ref: null,
  badge: status(m).label,
  chip: whenLabel(m),
  cta: opponentPost(m) ? 'Challenge on TurfSides →' : 'Join on TurfSides →',
  photo: m.venue.photo,
});
const cardVersion = (m: Linked) => createHash('sha1').update(JSON.stringify(cardInput(m))).digest('hex').slice(0, 10);
export const matchCardUrl = (m: Linked) => `${config.PUBLIC_URL.replace(/\/+$/, '')}/t/${m.shortCode}/card.jpg?v=${cardVersion(m)}`;

const cards = new Map<string, Buffer>();
/** The share card JPEG for a request, rendered once per version. */
export async function matchCard(m: Linked) {
  const key = `${m.shortCode}:${cardVersion(m)}`;
  const hit = cards.get(key);
  if (hit) return hit;
  const jpg = await renderCard(cardInput(m));
  cards.set(key, jpg);
  if (cards.size > 40) cards.delete(cards.keys().next().value!);
  return jpg;
}

export function matchPage(m: Linked) {
  const name = matchName(m);
  const st = status(m);
  const photo = m.venue.photo ?? `${config.PUBLIC_URL}/static/brand/og-default.png`;
  const facts = [whenLabel(m), versus(m.format), levelLabel(m.level), priceLabel(m)];
  const what = opponentPost(m) ? 'Looking for an opponent team' : 'Looking for players';
  const description = `${what} at ${place(m)}. ${whenLabel(m)} · ${versus(m.format)} · ${priceLabel(m)}. ${st.label}.`;
  return {
    status: 200,
    html: shell({
      title: `${name} · TurfSides`,
      og: { title: `${name} · ${m.venue.name}`, description, image: matchCardUrl(m), imageAlt: `${name} at ${place(m)}, ${whenLabel(m)}.`, card: true, url: m.shareUrl! },
      body: `<main class="card">
  <div class="photo" style="background-image:url('${esc(photo)}')"></div>
  <div class="pad">
    <p class="ref">${esc(st.label.toUpperCase())}</p>
    <h1>${esc(name)}</h1>
    <p class="place">${esc(place(m))}</p>
    <p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
    ${openInApp(m.shortCode, st.open ? (opponentPost(m) ? 'Challenge them in the app.' : 'Ask to join in the app.') : 'See the details in the app.')}
  </div>
</main>`,
    }),
  };
}
