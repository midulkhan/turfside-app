# TurfSides — Website guide (build, features, caching, safety, testing)

> **Read this before writing any code for the TurfSides website.** It is the single source of truth
> for a new chat or a new developer: what already exists, how every feature works today, how the
> website must plug into it, and the rules that keep the player app, the owner dashboard and the API
> from breaking each other.
>
> Companion docs: `ARCHITECTURE.md` (repo root; overall architecture, written 15 Nov 2026) and the
> `claude/app-handoff-*.md` notes in the Project. Where they disagree, **this guide is newer** (written 27 Nov 2026).

---

## 0. The 20 rules (if you read nothing else)

1. **One API, one database.** The website talks only to `https://api.turfsides.com`. Never to Postgres,
   Supabase (except the public realtime feed), Redis or R2 directly. No secret ever goes into website code.
2. **Never change what an existing endpoint returns or accepts** in a way old clients can't handle. Only
   add fields and routes. Phones run old app versions for months.
3. **Slot availability is never cached** anywhere: not in the API, not in the website (no ISR, no `fetch`
   cache, no CDN), not in the browser beyond the current page. Fetch it live, refresh on realtime events.
4. **Money is integer poisha** (1 taka = 100 poisha) everywhere in the API. Format only at the edge.
5. **Every money-moving POST sends an `Idempotency-Key` header** (a fresh UUID per user action, reused on retry).
6. **Dates are Dhaka dates** (`YYYY-MM-DD`, Asia/Dhaka) and times are **minutes from midnight**; an
   `end` can be above 1440 (a slot running past midnight). Never use the browser's time zone for slot logic.
7. **Prices and availability come from the server.** The website never computes a price, a slot list, a
   partial amount or a commission itself. It shows what the API returns.
8. **Don't touch the player app's code** (`src/`) to build the website. The website gets its own folder (§4).
9. **Database migrations are additive only**, numbered, and registered in `server/src/migrations.ts`.
   Never edit one that has shipped.
10. **Every server change ships with tests**, and the full suite must pass. A red CI run blocks the deploy, on purpose.
11. **Another chat works on the owner dashboard and pushes to the same repo.** Always
    `git fetch && git rebase origin/main` before pushing, and never force-push `main`.
12. **Don't store refresh tokens in `localStorage`** or anywhere JavaScript can read them (§7).
13. **Players and owners are separate accounts** (`/v1/auth` vs `/v1/owner/auth`). The website is for
    players; never mix tokens.
14. **Use the design tokens** (§10), never hard-coded colours or sizes. Lime = primary action/active only,
    orange = brand accent only.
15. **Respect the product rules** in §3 (partial payment, squads without payment, cancel 6 h, phone consent, guests).
16. **Keep `turfsides.com/<7-char code>` share links working** (§12) and `/.well-known/assetlinks.json`
    served as JSON with no redirect. Breaking them breaks every link already shared on WhatsApp.
17. **Cache invalidation is explicit**: a change to turf data goes through the API, which clears the cache.
    Never "fix" stale data by adding timers or by bypassing the cache (§9).
18. **Rate limits exist** (§6.4). Debounce search, don't poll faster than the app does, and send
    `X-Install-Id` for guests.
19. **Run typecheck, lint, unit, e2e and a manual pass** before saying anything is done (§13).
20. **When unsure, read the server code** (`server/src/services/*`) instead of guessing. It is the truth.

---

## 1. What exists today

| Piece | What | Where | Deploy |
|---|---|---|---|
| Player app | Expo SDK 58 / React Native 0.88, Expo Router | repo root `src/` | EAS builds (Android/iOS) |
| API | Node 22, Fastify 5, zod, `pg` | `server/` | push to `main` → GitHub Actions (tests) → cPanel (FTPS) |
| Owner dashboard (web) | Next.js 16 | separate project `turfsidesadmin` (owner's Mac `~/Projects/turfsidesadmin`), built by the other chat | its own deploy |
| Share-link files | `.htaccess` + `.well-known/assetlinks.json` | `site/` → uploaded to the turfsides.com folder on cPanel | manual upload |
| **Website (to build)** | Player website at turfsides.com | `web/` (planned, §4) | its own pipeline (§14) |

Repos: `github.com/midulkhan/turfside` (main; its Actions deploy the API) and `github.com/midulkhan/turfside-app`
(a mirror; push to both). The owner's Mac copy is `/Users/user/Projects/turfsides`.

Services: Supabase Postgres (API only; RLS denies the public keys everything except the realtime feed),
Upstash Redis (cache), Cloudflare R2 (photos), bKash (payments, `simulate` mode for tests), SMTP email,
Expo push, pg_cron jobs (release expired holds, reconcile payments).

```
 Player app      Website (new)      Owner dashboard      (Company dashboard, later)
     │                │                    │
     └────────────────┴─────────┬──────────┘
                                ▼
               API — api.turfsides.com (Fastify)
   /v1/* players · /v1/owner/* owners · /v1/admin/* company (API key) · /t/:code share pages
                                │
      Postgres (Supabase) · Redis (Upstash) · R2 photos · bKash · SMTP · Expo push
```

---

## 2. Domains and URLs

| URL | Serves | Notes |
|---|---|---|
| `api.turfsides.com` | the API, plus the share pages `/t/:code` and cards `/t/:code/card.jpg` | Node on cPanel |
| `turfsides.com` | today: static folder with `.htaccess` that 302-redirects `/<7-char code>` → `api.turfsides.com/t/<code>`, and `/.well-known/assetlinks.json` | **the website will live here** (§12) |
| `turfsides://…` | the app's URL scheme; `turfsides://t/<code>` opens a turf or game | used by share pages |
| `pub-….r2.dev` (R2_PUBLIC_URL) | turf photos and avatars | public, immutable files |

Share links: `turfsides.com/F72DZZS`. Turfs and player/opponent requests share **one pool of 7-character codes**
(letters A–Z without I and O, digits 2–9). Turf IDs shown to people look like `TS-5741` (`venues.ref_no`) and are
searchable (§5.2).

---

## 3. Product rules (current, authoritative)

These were decided by the owner. The website must behave exactly the same as the app.

### 3.1 Guests can browse, members can act
- Without an account: explore turfs, search (name, area or turf ID), open a turf, see its slots, prices,
  photos, reviews, map, and open share links.
- An account is required for: booking (anything after picking slots), saving a turf, notifications,
  squads and opponents (viewing and joining), tickets, profile and settings.
- In the app, a guest who tries one of those gets a **sign-in drawer** ("Sign in to book this slot") with
  *Sign in* / *Create an account*. After signing in they return to the **same screen** and the action
  continues (picked slots kept, checkout opens). The website should do the same: a sign-in modal, then
  continue with the action. Never lose the user's picked slots.
- Members-only pages for a guest show a short "Sign in or create an account" state, not an error.

### 3.2 Booking and payment
- Flow: pick slots (max 6 per checkout; the server enforces it) → **hold** (`POST /v1/holds`, slots reserved for `HOLD_MINUTES`,
  default 5) → checkout → **pay** (`POST /v1/payments`) → bKash → back → confirmed booking/ticket.
- **Two ways to pay** (checkout shows both when available):
  - *Full payment*: everything now.
  - *Partial payment*: **500 tk per slot** now, the rest at the turf. Offered only when a slot costs
    more than 500 tk (`hold.partial.available`). Send `mode: 'partial'`.
- The hold response carries `partial: { available, perSlot, now, atTurf }` (poisha). Show those numbers;
  never compute them.
- Tickets show `amountPaid`, `total`, `dueAtVenue`, `payMode`. If `dueAtVenue > 0`, show "Pay ৳X at the turf".
- No service fee is shown while it's 0 (the API omits the line).
- Commission is always on the full price and is **never shown** to players or owners.
- No note field at checkout any more (the API still accepts `note`, but the app no longer sends it).

### 3.3 Cancellation
- Players can cancel up to **6 hours** before kick-off (`POST /v1/bookings/:id/cancel`); the API refuses later.
- Whatever was paid online is marked for refund (`refund_required`); bKash refunds will be automated later.
- The app has no cancel button yet. If the website adds one, it must handle the API's refusal message.

### 3.4 Squads (find players) and opponents
- A host who booked a slot can post **"Need players"** (spots) or **"Find an opponent"** (one team).
- Others **request** to join (players) or **challenge** (teams). The host **accepts** → confirmed at once.
- **No payment in the app** for joining. The page still shows the share ("৳1,360 for your team",
  "৳X per player") with "Pay the host at the turf". `POST /v1/matches/:id/pay` returns 403 on purpose.
- A confirmed player/team can leave (`DELETE /v1/matches/:id/join`); the spot reopens and the host is notified.
- Bottom button when confirmed: **"Game On"**.
- **Phone numbers**: shared only with explicit consent, only between host and confirmed members, never
  between players. Each side may share a different number for that game. Never display a number the API didn't return.

### 3.5 Other rules
- Reviews: one per player per turf, only after playing; final (no edit/delete).
- Turning 2FA off requires the password.
- Prices: one-hour sessions show "/hr"; other session lengths show minutes ("/90 min", "/120 min").
- Turf share message and share card: see §5.9.

---

## 4. Website: recommended setup

These are recommendations; confirm with the owner before deviating.

- **Framework**: Next.js (App Router, TypeScript), like the owner dashboard. Server components for public,
  SEO-relevant pages (home, turf pages, area pages); client components for anything live (slots, checkout).
- **Data**: TanStack Query on the client (same as the app), with the same query keys where it makes sense.
- **Styling**: Tailwind or CSS variables **generated from `src/theme/tokens.ts`** (§10). Don't copy values by hand.
- **Location in the repo**: a new top-level `web/` folder with its own `package.json`, lockfile, tsconfig,
  lint config and tests. **Don't import from `src/`** (React Native code). Copy the small pure helpers you
  need (Dhaka time, money formatting, price-unit labels) into `web/lib/`, with tests, or move them into a
  shared `packages/` folder later (the monorepo plan in ARCHITECTURE.md §9). Never edit `src/` to suit the website.
- **CI**: the API deploy workflow only runs for `server/**` and `src/features/api/**`. Give the website its
  own workflow (`.github/workflows/web.yml`) that runs typecheck, lint, unit and e2e tests on every push to
  `web/**`, and deploys only if they pass.
- **Hosting**: Vercel or Cloudflare Pages are simplest for Next.js; cPanel can only host a static export.
  Whatever is chosen, the share-link and `assetlinks.json` behaviour in §12 must keep working on turfsides.com.

Suggested structure:
```
web/
  app/                     routes (App Router)
    page.tsx               home / explore
    turf/[id]/page.tsx     turf page (SSR shell + live slots on the client)
    [code]/page.tsx        7-char share codes → turf or game (replaces the .htaccess redirect, §12)
    checkout/…, booking/[id]/…, squads/…, account/…
    api/auth/…             BFF routes holding the refresh cookie (§7)
  lib/api/                 typed client (mirror of src/features/api/client.ts + types.ts)
  lib/                     dhaka-time.ts, money.ts, price-unit.ts (copied with tests)
  components/
  styles/tokens.css        generated from src/theme/tokens.ts
  tests/                   unit (vitest) + e2e (Playwright)
```

---

## 5. Features and how they work (API side)

All endpoints are under `https://api.turfsides.com`. Types live in `src/features/api/types.ts` (copy them).
Guest-allowed endpoints use `optionalUser` (a token is used if present, so `isSaved`, `mine` etc. are filled in).

### 5.1 Explore (home)
- `GET /v1/venues/explore?lat&lng&radius&day&format&q&limit&cursor` → `{ radiusKm, near[], further[], … }`.
  `radius` (1–50 km) is the distance slider; omit it for the adaptive 5→30 km search.
- Cached on the server (catalog, §9). Rate-limited 60/min per session/install.
- Location: the user's GPS, a picked area, or a saved place (`/v1/me/places`, members only). Default area is Dhaka.

### 5.2 Search
- Same explore endpoint with `q`. Matches name or area, **or the turf ID**: `TS-5741`, `ts5741`, `5741`,
  the first 3+ digits, or the 7-char share code. An exact ID match comes first.
- Debounce (≥300 ms). Narrowing results locally is fine for letters, but not for digits (an ID only matches
  from 3 characters), so digit queries always go to the server.

### 5.3 Turf page
- `GET /v1/venues/:id` → details incl. `ref` ("TS-5741"), `shareUrl`, `startingPrice`, `version`.
  Served from the per-turf Redis key (§9). Show the ID with a copy button.
- `GET /v1/venues/:id/slots?day=YYYY-MM-DD` → `{ slots[], fetchedAt, turfVersion }`. **Live, never cached.**
  Statuses include `available`, `mine` (your hold), `booked`, held by others, closed. A booked slot may carry
  `squad` (a squad recruiting on it; for guests, opening it needs sign-in).
- If `turfVersion` differs from the `version` of the turf details you have, refetch the details (an owner just
  edited the turf). That's how the app stays fresh without polling the details.
- `GET /v1/venues/:id/reviews` (+ `PUT /v1/venues/:id/reviews/mine` for players who played).
- `GET /v1/venues/:id/tournaments` (public, upcoming).
- Realtime (§8) tells you when to refetch slots.

### 5.4 Holds (the cart)
- `POST /v1/holds` with `{ slotIds: [...] }` (or `slotId`) and `Idempotency-Key` → `{ holdId, slots, lines, total, partial, expiresAt, … }`.
- `GET /v1/holds/:id`, `DELETE /v1/holds/:id` (release), `DELETE /v1/holds/:id/slots/:slotId` (remove one).
- `GET /v1/me/holds` lists your open holds. A new hold for the same user replaces the previous cart.
- Errors to handle: `slot_taken` (someone was faster: refresh slots, tell the user), `hold_expired`.

### 5.5 Payment (bKash)
- `POST /v1/payments` `{ holdId, mode: 'full'|'partial', returnUrl? }` + `Idempotency-Key` → `{ paymentId, checkoutUrl }`.
- Redirect the browser to `checkoutUrl` (bKash). After paying, bKash calls `GET /v1/payments/bkash/callback`,
  which finalises the payment and then sends the browser to `returnUrl`.
- **Website blocker:** `safeReturnUrl` (`server/src/services/payments.ts`) only accepts `turfsides://…` in
  production. The website needs a server change: also accept URLs starting with `SITE_URL` (exact origin
  `https://turfsides.com/`, e.g. `https://turfsides.com/payment/return`). Keep the check strict (no open
  redirects: compare the parsed origin, not a prefix that `https://turfsides.com.evil.com` could match).
  Add a test for both the allowed and a rejected lookalike URL.
- Then poll `GET /v1/payments/:id` (as `payment-return.tsx` does) until `confirmed`/`failed`, and open the
  ticket (`bookingId`).
- `BKASH_MODE`: `off` | `simulate` (tests: `POST /v1/payments/simulate/:id` with `action=pay`) | `sandbox` | `live`.

### 5.6 Bookings and tickets
- `GET /v1/me/bookings` (paged, filters `all|open|closed`), `GET /v1/bookings/:id`.
- The ticket shows the entry pass code (`TS-261121-7604`) and QR (`GET /v1/passes/:id/qr.png`).
  Owners scan it (`/v1/passes/verify`, `/check-in`, owner-only); the scanner also gets `dueAtVenue`.
- **Never make tickets public by URL** (no share link for tickets). If that's ever wanted, use an unguessable
  token and a limited public view (see the IDOR notes in the chat history: long random token, no pass code on
  the public view, expiry/revocation, rate limits).

### 5.7 Squads and opponents
- Feed: `GET /v1/matches?type=players|opponent&…`; `GET /v1/matches/:id`; host: `POST /v1/matches`,
  `PATCH /v1/matches/:id`, `GET /v1/matches/:id/manage`, `POST /v1/matches/:id/requests/:userId/accept|decline`;
  joiner: `POST /v1/matches/:id/join` (players: spots, position, level, phone consent; opponents: team name,
  team size, level), `DELETE /v1/matches/:id/join` to leave; lists: `/v1/matches/joined`, `/v1/matches/mine`.
- Member status `paid` means **confirmed** (historical name). `shareUrl` on each request = its share link.

### 5.8 Account
- Players: `/v1/auth/*` (signup start/verify with emailed code, login, login/verify + resend for 2FA, refresh,
  logout, password reset start/verify) and `/v1/me` (profile), `/v1/me/settings` (2FA off needs `password`),
  `/v1/me/sessions` (+ revoke, revoke-others), `/v1/me/password`, `/v1/me/phone/start|verify`, `/v1/me/avatar`
  (upload via `POST /v1/uploads` → R2), `/v1/me/delete`, `/v1/me/saved/:venueId`, `/v1/me/places`,
  `/v1/me/notifications` (paged with `limit` + `before` cursor), `/v1/me/requests`.
- Push tokens (`/v1/me/push-token`) are for the phone app; the website doesn't register any.

### 5.9 Share links and previews
- `GET /v1/links/:code` → `{ kind: 'turf'|'match', id }` (any code; 404 if unknown).
- `GET /t/:code` → light HTML page with Open Graph tags; `GET /t/:code/card.jpg` → branded 1200×630 JPEG
  (cached per content hash; immutable 7 days). Turf share message format: name, area, formats · from ৳X/unit · ★,
  then "Book it on TurfSides 👉 <link>".
- Public pages show only public data: never player names or phone numbers.

### 5.10 Notifications on the web
- In-app list: `/v1/me/notifications`. No web push for now (would need a new server feature; don't fake it).

---

## 6. API conventions

### 6.1 Requests and responses
- JSON in and out. Auth: `Authorization: Bearer <access token>` (player audience).
- Also send `X-Device: Web browser` (shown under "Signed-in devices") and `X-Install-Id: <uuid>` (§6.4).
- Errors: `{ error: { code, message, field? } }`. Show `message` to the user (it's written for people).
  Codes: `unauthorized`, `forbidden`, `not_found`, `invalid`, `conflict`, `rate_limited`, `slot_taken`,
  `hold_expired`, `payment_failed`, `not_configured`, `internal` (plus the client-side `network`). Map `field` errors onto form fields.
- Timeouts: the app gives up after 15 s; do the same and show a retry.

### 6.2 Money, time, IDs
- Poisha integers. Format with the Taka font/sign as the app does (`formatTaka`).
- `day` = Dhaka `YYYY-MM-DD`; `start`/`end` = minutes from Dhaka midnight (end may be > 1440).
- Slot ids look like `venueId:YYYY-MM-DD:start`. Treat ids as opaque strings.

### 6.3 Idempotency
- `POST /v1/holds`, `POST /v1/payments` and other money/booking writes take `Idempotency-Key`.
  Generate one per user action, keep it while retrying the same action, make a new one when the
  user changes something (e.g. switching full ↔ partial creates a new key).

### 6.4 Rate limits
- Global: `RATE_LIMIT_PER_MIN` per IP (default 120; check cPanel env). Many Bangladeshi users share carrier IPs.
- Auth routes: `AUTH_RATE_LIMIT` (default 10/min). Explore: 60/min per session.
- Per-session limits key on the bearer token; **guests** are keyed on `X-Install-Id` (a UUID; the website should
  generate one per browser and keep it in a first-party cookie or localStorage). Without it, guests fall back to IP.
- Don't poll faster than the app: slots every 4 s only while a checkout/hold needs it, 15 s otherwise, and
  only while the page is visible. Prefer realtime (§8).

### 6.5 Compatibility
- Old app versions keep calling the same routes. Add fields, never rename or remove. A breaking change = a new
  route or `/v2/`, with `/v1` kept until old apps are gone.

---

## 7. Auth on the website (security-critical)

- Access tokens are JWTs valid **15 minutes**; refresh tokens last **30 days** and **rotate on every refresh**
  (reusing an old one fails). Sessions are per device and can be revoked.
- The phone app keeps the refresh token in secure storage. A browser has no equivalent, so:
  - **Never put the refresh token in `localStorage`/`sessionStorage`** (any XSS would steal 30-day access).
  - Recommended: a small **BFF** in the Next.js app (`web/app/api/auth/*`): it calls `/v1/auth/login`,
    `/verify`, `/refresh`, `/logout` server-side, keeps the refresh token in an **httpOnly, Secure,
    SameSite=Lax** cookie, and hands the browser only the short-lived access token (kept in memory).
  - One refresh at a time (the app's `http.ts` shares one in-flight refresh between parallel 401s; copy that).
  - Logout: call `/v1/auth/logout`, clear the cookie, clear the query cache.
- CSRF: with SameSite=Lax cookies and JSON-only POSTs from the same site, the BFF routes are safe; still check
  the `Origin` header on BFF POSTs.
- If the browser calls the API directly (not through the BFF), add the website origin to the API's
  `CORS_ORIGINS` env var on cPanel. Never use `*`.
- Content Security Policy: allow `api.turfsides.com`, the R2 photo host, the Supabase realtime host, bKash
  pages (navigation only) and the map tiles you use. No inline scripts except Next's nonce'd ones.
- 2FA: if `/v1/auth/login` answers with a challenge, show the code step (`login/verify`, `login/resend`).
- Owner accounts must never be able to sign in on the player website (different audience; the API already enforces it).

---

## 8. Realtime (live slots)

- `GET /v1/config` → `{ paymentsEnabled, horizonDays, horizonEnd, realtime: { url, anonKey, table: 'slot_updates', matchTable: 'match_updates' } }`.
  The anon key is public by design: RLS lets it read only these tiny tables.
- Subscribe with Supabase Realtime to `slot_updates` filtered by `venue_id=eq.<id>`. Each event says a day of
  that turf changed: refetch `GET /v1/venues/:id/slots?day=…` for that day (copy `src/features/api/realtime.ts`).
- Special day **`2000-01-01`** (`TURF_INFO_DAY`) means "the turf's details changed" (owner saved the turf):
  refetch the turf details and its slots, not a booking day.
- `match_updates` does the same for squads.
- Realtime is a hint, not data. Always refetch from the API; never trust event contents for availability.
- If realtime is unavailable, fall back to the polling intervals in §6.4, only while the tab is visible.

---

## 9. Caching (server, website, browser)

### 9.1 What the server caches (and how it's cleared)

Two levels (`server/src/cache.ts`): **L1** in-process LRU, **L2** Upstash Redis (shared by all Node processes).
Upstash bills every command (free plan 500K/month), so the layer is frugal:

| What | Key | Lifetime | Cleared by |
|---|---|---|---|
| Catalog of published turfs (explore, lists) | `venues:all` + version `catalog:ver` | ≤ 1 h; each process checks the version at most once per second | `invalidateVenue()` bumps the version and deletes the key |
| One turf (turf page, slots' turf data) | `venue:<id>` | ≤ 1 h safety TTL | `invalidateVenue(id)` deletes it on every owner save |
| Public reviews of a turf | reviews key | 1 h | new review |
| bKash token | `bkash:id_token` | token lifetime | expiry |
| Share cards | in-memory map, content-hash keyed | until content changes | hash changes automatically |
| **Slots, holds, bookings, payments, me/** | **never cached** | — | — |

Safety rules built into the cache (don't remove them):
- **No TTL may exceed `MAX_TTL_S` (1 h).** After a failed Redis write the API stops reading Redis for
  `MAX_TTL_S`, so any copy that missed an update has expired before reads resume. A longer TTL breaks that guarantee.
- A per-process daily read budget (`REDIS_DAILY_BUDGET`) protects the free plan; writes that keep the shared copy correct always go through.
- Every cache call is time-limited (1.2 s) and best-effort: if Redis is slow or down, requests go to Postgres.
- `singleflight`: concurrent misses for the same key do one database query.
- Every owner-side write that changes a turf **must call `invalidateVenue(id)`** (details, schedule, prices,
  photos, pause, listing, removal, reviews). It also writes the realtime `TURF_INFO_DAY` signal.
  Adding a new turf-changing route? Call it, and add a test that the change shows on the next read.

### 9.2 What the website may cache
- **Turf pages (SEO)**: render the turf details on the server with a short revalidation (e.g. 60 s) or on-demand
  revalidation. Treat it as a shell: price/availability shown to buyers comes from the live client fetch.
- **Explore/home**: client-side TanStack Query, `staleTime` ≈ 60 s (as the app). Server-rendered lists may revalidate ≤ 60 s.
- **Never cache** (`cache: 'no-store'` / `dynamic = 'force-dynamic'`): slots, holds, payments, bookings, tickets,
  anything under `/v1/me`, matches you're part of, and anything sent with an `Authorization` header.
  Never let a CDN cache a response that depends on who is signed in.
- Photos (R2) and `/t/:code/card.jpg` are immutable: cache freely.

### 9.3 Browser (TanStack Query) — the app's values, use the same
| Query | staleTime |
|---|---|
| explore / feed | 60 s (keep previous data while filters change) |
| turf details | until the server signals a new `version` (slots' `turfVersion` or realtime) |
| slots | 0, no garbage-collection cache; refetch every 4 s while holding, 15 s otherwise |
| saved, notifications | 60 s |
| bookings | 30 s (paged 10 at a time) |
| my holds | 10 s, refetch 30 s |
| match | 10 s; match feed 20 s |
| places, settings | 5 min |

Clear the whole query cache on sign-out.

---

## 10. Design system for the website

Source of truth: `src/theme/tokens.ts`. Generate CSS variables from it (a small script in `web/scripts/`),
for both light and dark (`prefers-color-scheme` + a user toggle stored in a cookie).

- Font: **Geist** (400/500/600/700/800, 800 italic for the wordmark style). Taka sign uses the **Taka** font
  (Taka-Medium/Bold/ExtraBold in `assets/fonts/`, OFL licence).
- Key colours (light / dark): bg `#F4F5F0` / `#0E1213`; surface `#FFFFFF` / `#171C1E`; text `#161B1D` / `#EEF1EA`;
  muted text `#5C6468` / `#A3ABAE`; border `#E2E5DC`; lime `#DDF85C` (both); lime text `#4E6B00` / `#C8E64F`;
  orange `#FF5A1F`; danger `#D92D20`; bKash `#E2136E`. Use the token names, not these literals.
- Radius: xs 8 · sm 12 · md 18 (images in cards, slot tickets) · lg 24 (cards, sheets) · xl 32 · pill 999.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56; page gutter 20.
- Type: h1 28/34 bold; pageTitle 26/32 semibold; h2 22/28 bold; body 16/22; label 14/18 medium; caption 12.5/16 medium.
- Controls are pill-shaped, 56 px tall (44 small). Cards: `radius.lg`, 1 px `border`.
- Lime = primary actions and active states only. Orange = brand accent only (logo slash).
- Accessibility: 4.5:1 text contrast, visible focus rings, real `<button>`/`<a>` elements, labels on icon buttons,
  `prefers-reduced-motion` respected, everything usable with a keyboard.

---

## 11. How to write code without breaking anything

### 11.1 Before you start
- `git fetch origin && git rebase origin/main`. The other chat may have pushed.
- Read the service file for the area you touch (`server/src/services/<area>.ts`) and its tests.
- Read `AGENTS.md` before any Expo/React Native change (Expo APIs change every SDK; use the versioned docs).

### 11.2 Server changes (only if the website truly needs them)
- Add, don't change. New response fields are fine; renaming/removing is not.
- Validate every input with zod in the route (`parse(schema, body)`), check ownership on every row
  (`where user_id = $2`), never trust ids from the client.
- Money writes: idempotency key, transaction, row locks (`for update`), ledger rows appended (never edited).
- Migrations: new file `server/db/migrations/0NN_name.sql` (next free number), idempotent SQL
  (`if not exists`, guarded constraints), registered in `server/src/migrations.ts`. Additive only.
- Anything that changes a turf → `invalidateVenue(id)`.
- New rate limits for anything expensive or abusable.
- Write the test first or alongside (§13). Owner/admin features get their own test files.

### 11.3 Website code
- Typed API client mirroring `src/features/api/client.ts` + `types.ts`. One place for the base URL, headers,
  refresh, timeouts and error mapping.
- No business logic duplicated from the server (pricing, availability, partial amounts, permissions).
- Server components must not leak tokens to the client bundle. Env vars that reach the browser are only the
  public ones (`NEXT_PUBLIC_API_URL`); everything else stays server-side.
- Handle every state: loading (skeletons), empty, error (with retry), offline, signed out.
- Sanitise nothing by `dangerouslySetInnerHTML`; render text. Owner-entered text (turf names, rules) is untrusted.
- Images through `next/image` with the R2 domain allow-listed; always set width/height to avoid layout shift.

### 11.4 The player app (if you must touch it)
- `npx tsc --noEmit` and `npx expo lint` must pass. Never edit `ios/`/`android/` (generated).
- Native module added? The app needs a new development build.

### 11.5 Git and syncing
- Small commits with clear messages. Push to **both** remotes (`origin`, `app`).
- Pushing `server/**` triggers test + deploy; wait for the GitHub Action to finish and check it passed
  (`gh run list -R midulkhan/turfside -L 1`).
- The owner works from `/Users/user/Projects/turfsides`; changed files are synced there after each task.

---

## 12. turfsides.com and the share links (don't break these)

Today `turfsides.com` is a cPanel folder with `site/.htaccess`:
`/^[A-HJ-NP-Z2-9]{7}/?$` → 302 to `https://api.turfsides.com/t/<code>`, and `/.well-known/assetlinks.json` served as JSON.

When the website takes over turfsides.com:
1. **Keep `/<7-char code>` working.** Either keep the redirect (simplest), or implement `web/app/[code]/page.tsx`:
   validate the code, call `GET /v1/links/:code`, and render the turf/game page with the same Open Graph tags
   (`og:image` = `https://api.turfsides.com/t/<code>/card.jpg?v=…`). Unknown code → friendly 404. Real routes
   must never be 7 characters of that alphabet in capitals (or they'd collide).
2. **Serve `/.well-known/assetlinks.json`** exactly as in `site/.well-known/assetlinks.json`, `Content-Type:
   application/json`, no redirect. It currently holds the **debug** signing fingerprint; when the app gets its
   real upload key and Google Play signing, add those fingerprints (keep the old one until no build uses it).
3. Later, iOS Universal Links need `/.well-known/apple-app-site-association` (paid Apple developer account).
4. Check after every deploy: `curl -I https://turfsides.com/.well-known/assetlinks.json` (200, JSON) and open a
   real share code.

---

## 13. Testing (do all of it)

### 13.1 API test suite (exists)
- 20 files, 123 tests (Vitest) in `server/test/`: e2e tests run against a real API process, a throwaway
  Postgres 16 and Redis (through `server/scripts/upstash-local.mjs`, an Upstash-compatible shim).
- CI (`.github/workflows/deploy-server.yml`): `npm ci` → `npm run build` (typecheck + bundle) → start two API
  processes (memory cache and Redis cache) → `npx vitest run` → deploy only if green.
- Locally (from `server/`): Postgres + Redis running, `node scripts/upstash-local.mjs`, the env from
  `deploy-server.yml` (incl. `EMAIL_DRY_RUN=true`, `BKASH_MODE=simulate`, `ADMIN_API_KEY`), `npm run build`,
  start `node dist/index.js`, then `API_URL=http://localhost:4010 npx vitest run`.
- Gotchas: rate-limit counters live in Redis, so back-to-back runs within a minute can 429 (flush Redis or wait);
  cache tests fail if Redis or the shim isn't running.
- Every new endpoint or behaviour gets an e2e test: happy path, permission (other user/owner gets 403/404),
  validation errors, idempotency (same key twice = one result), and cache freshness (change → next read shows it).

### 13.2 Website tests (to set up)
- **Typecheck + lint** on every push.
- **Unit tests (Vitest)** for pure helpers: Dhaka dates around midnight, minutes > 1440, money formatting,
  price-unit labels ("/hr" vs "/90 min"), turf-ID search normalisation, token-refresh queueing.
- **E2E (Playwright)** against a local API with `BKASH_MODE=simulate` and seeded demo turfs
  (`.github/workflows/seed-demo-turfs.yml` / `docs/postman/demo-turfs.json`). Must cover:
  1. Guest: home → search by name and by `TS-####` → turf page → slots visible.
  2. Guest picks slots → sign-in modal → sign in → back on the turf with the slots → checkout opens.
  3. Checkout full and partial: amounts match `hold.partial`; simulate payment; ticket shows paid/due.
  4. Slot taken by another user between pick and hold → clear message, slots refreshed.
  5. Hold expiry → "your hold expired" path.
  6. Squads: post, request, accept → confirmed, "Game On", no pay button; leave → spot reopens.
  7. Share codes: `/<code>` for a turf and for a game; unknown code → 404 page; OG tags present.
  8. Account: sign up with code, 2FA login, refresh after 15 min (fake clock or short-lived token), logout clears data.
  9. Members-only pages as guest → sign-in state, never a crash or someone else's data.
  10. Cache freshness: owner edits a turf (owner API) → website shows it on next load.
- **Security checks**: no tokens in `localStorage`; responses with `Authorization` not cached (check headers);
  CSP present; no secrets in the client bundle (`grep` the build output for env names).
- **Performance**: Lighthouse on home and a turf page (mobile), LCP < 2.5 s on 4G, small JS on public pages.
- **Manual pass** before release: light + dark, small phone width (360 px), desktop, slow 3G throttling, keyboard only.

### 13.3 Definition of done
Typecheck, lint, unit, e2e and (for server changes) the full API suite green; manual pass done; deployed;
`/health` OK; share links and `assetlinks.json` checked; both repos pushed; owner's Mac synced.

---

## 14. Deploying

| What | How |
|---|---|
| API | Push to `main` (paths `server/**`, `src/features/api/**`) → GitHub Actions tests → FTPS to cPanel → restart. Migrations run on start. |
| Player app | EAS builds (`eas.json` profiles: development, development-simulator, preview APK, production). |
| Website | Its own workflow and host (§4). Env: `NEXT_PUBLIC_API_URL=https://api.turfsides.com`, cookie secret for the BFF. |
| turfsides.com share files | `site/` uploaded to cPanel until the website replaces it (§12). |

Secrets live only in cPanel env vars, GitHub secrets and the website host's env. Never in the repo, never in chat.

Useful checks: `https://api.turfsides.com/health` (database, cache, push delivery); the `diagnose.yml` workflow
(`gh api -X POST repos/midulkhan/turfside/actions/workflows/diagnose.yml/dispatches -f ref=main`).

---

## 15. Server changes the website will need (plan them, test them)

1. `safeReturnUrl`: allow return URLs on the `SITE_URL` origin (strict origin compare) + tests (§5.5).
2. `CORS_ORIGINS`: add the website origin if the browser calls the API directly.
3. Optional: a sitemap source (published turfs with `updatedAt`) so search engines index turf pages.
4. Optional: raise `RATE_LIMIT_PER_MIN` on cPanel (e.g. 600) once guests browse on the web.
5. If cookies are ever handled by the API itself instead of a BFF: a separate, carefully reviewed change
   (SameSite, CSRF, CORS credentials). Don't improvise it.

---

## 16. Known gaps and backlog (so nobody is surprised)

- Players can't cancel from the app (server supports it, 6 h rule). Decide before adding it to the website.
- bKash refund API not integrated yet (`refund_required` is recorded).
- `owner_earnings.collected` exists; payouts should pay `collected − commission` for partial bookings (owner chat).
- Android 11 crash report never received; splash video re-encoded for older phones.
- iOS Universal Links need a paid Apple account. Release Android builds use the debug signing key today.
- Monorepo move and shared `packages/*` not done yet (ARCHITECTURE.md §9).
- Staff accounts (`venue_members`) not built.

---

## 17. Glossary

- **Hold**: slots reserved for a few minutes while the player pays. **Order**: one checkout (one or more slots).
- **Booking**: one slot of an order. **Ticket**: back-to-back bookings shown as one.
- **Pass**: the QR/entry code checked at the turf. **Walk-in**: a booking an owner adds for someone at the counter.
- **Partial payment**: 500 tk per slot online, the rest at the turf (`dueAtVenue`).
- **Squad / request**: a host's post for players (`type: players`) or an opponent team (`type: opponent`).
- **Turf ID**: `TS-####` (`ref_no`). **Share code**: 7 characters, turfsides.com/<code>.
- **Catalog**: the cached list of published turfs. **invalidateVenue**: the one function that clears a turf from every cache.
- **Realm**: `player` or `owner` accounts (separate tables, tokens and routes).
