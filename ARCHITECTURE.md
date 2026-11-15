# TurfSides — Architecture & Rules

> **Read this first** before changing anything in this repo (people and AI assistants alike).
> It describes what exists today, the rules that keep the apps from breaking each other,
> and the plan for the owner dashboard (web + mobile) and the company dashboard.
> Last updated: November 2026.

---

## 1. The product

TurfSides lets players find nearby football turfs, book time slots, pay in the app, and fill
their squad with other players ("Find players"). Turf owners list and run their turfs.
In-app payments are the business model: every booking goes through the app.

| App | Who | Status | Where |
|---|---|---|---|
| Player app | Players | Built | Repo root (`src/`), Expo |
| API | Everyone | Built | `server/` (Fastify) → api.turfsides.com |
| Owner dashboard (web) | Turf owners | Built (v1) | Separate Next.js 16 project `turfsidesadmin` (owner's Mac: `~/Projects/turfsidesadmin`); moves to `apps/owner-web` with the monorepo |
| Owner app (mobile) | Turf owners & staff | Planned | `apps/owner-mobile` (Expo) |
| Company dashboard | TurfSides team only | Planned | `apps/admin-web` (Next.js) |

---

## 2. The one rule everything rests on

**One API, one database. Every app talks only to the API — never to the database directly.**

```
 Player app     Owner mobile    Owner web     Company dashboard
     │               │              │                │
     └───────────────┴──────┬───────┴────────────────┘
                            ▼
              API — Fastify — api.turfsides.com
     /v1/*  (players)   /v1/owner/*  (owners)   /v1/admin/*  (company, planned)
                            │
   Postgres (Supabase) · Redis (Upstash) · Photos (Cloudflare R2) · Expo push · SMTP email
```

- No Supabase service key, database URL or secret ever goes into an app or a web dashboard.
- Booking, holds, pricing, payments and permissions live in the API only. An owner's offline
  booking and a player's app booking go through the **same** code, so they can never disagree.
- Because there is one source of truth, an owner change (block a slot, change a price) shows up
  in the player app in real time with no syncing between apps.

---

## 3. Tech stack

| Part | Tech |
|---|---|
| Player app | Expo SDK 58, Expo Router (`src/app/`), React 19, TanStack Query, FlashList, Reanimated, expo-maps, expo-notifications |
| API | Node 22, Fastify 5, zod 4, `pg`, jose (JWT), nodemailer, bundled to one file (`server/build.mjs`) |
| Database | Supabase Postgres (accessed only by the API; RLS denies the public keys everything) |
| Cache | Upstash Redis (REST) + in-process LRU |
| Storage | Cloudflare R2 (S3 API via aws4fetch) |
| Realtime | Supabase Realtime on the tiny, non-personal `slot_updates` table only |
| Payments | bKash (with a `simulate` mode for tests) |
| Email | SMTP (noreply@turfsides.com); Sender.net as fallback |
| Push | Expo push API, outbox pattern |
| Jobs | pg_cron + pg_net inside Supabase (release expired holds, reconcile payments every minute) |
| Hosting | API on cPanel shared hosting (GitHub Actions deploy); app builds via EAS |

> Expo changes every SDK. Read `AGENTS.md` and the versioned Expo docs before touching Expo APIs.

---

## 4. Repository layout (today)

```
/                       Player app (Expo)
  src/app/              Screens (Expo Router). Every file is a route.
  src/components/       UI: ui/ (design-system primitives), venue/, match/, ticket/, explore/…
  src/features/api/     client.ts (typed fetch per endpoint), queries.ts (TanStack hooks),
                        realtime.ts (live slots), types.ts (API types), http.ts (base URL, auth)
  src/features/session/ Auth/session state, saved prefs
  src/features/notifications/  Push registration + routing
  src/lib/              Pure helpers: time (Dhaka), money, geo, validation…
  src/theme/tokens.ts   Design tokens — the single source of truth for colour/radius/spacing/type
  app.json, app.config.ts, eas.json, google-services.json
server/
  src/app.ts            Player + auth routes (and the original owner turf routes)
  src/routes/owner.ts   Owner dashboard routes (/v1/owner/* beyond turf CRUD), registered from app.ts
  src/services/         Business logic per area: auth, account, venues, bookings, payments,
                        matches (squads), reviews, owner (turf profile), owner-dash (owner dashboard)
  src/lib/              bkash, email, sms, push, storage (R2), crypto, tokens, time
  src/config.ts         Every env var, validated
  src/migrations.ts     Ordered migration list (import + register every new one)
  src/jobs.ts           pg_cron schedules
  db/migrations/        001…020 SQL, additive only
  test/                 Vitest e2e + unit (see §8)
.github/workflows/      deploy-server.yml (test + deploy), diagnose.yml, seed-demo-turfs.yml
docs/                   pass-qr.md, postman collection
```

GitHub: `midulkhan/turfside` (main repo; pushing `server/**` or `src/features/api/**` to `main`
triggers test + deploy). `midulkhan/turfside-app` is a full copy of the history.

---

## 5. API

Base: `https://api.turfsides.com`. JSON. Auth: `Authorization: Bearer <access JWT>`, refresh tokens
rotate via `/v1/auth/refresh`. Sessions are listed/revocable per device.

**Two kinds of account, never mixed** (migration 022): players sign in at `/v1/auth/*` and manage their
account at `/v1/me/*`; turf owners sign in at `/v1/owner/auth/*` and use `/v1/owner/me/*` (same flows:
sign-up with an emailed code, login + optional 2FA, refresh, logout, password reset by email or number,
settings, devices, password, name, phone, photo). Access tokens carry the audience (`turfsides-app` or
`turfsides-owner`): `requireUser` accepts only player tokens, `requireOwner` only owner tokens, so a token
of one kind gets 401 on the other's routes. Pass scanning (`/v1/passes/*`) is owner-only. Owner accounts
can't be deleted from the dashboard (support closes them; they own turfs and bookings).

| Area | Routes |
|---|---|
| Auth | `/v1/auth/signup/start|verify`, `login`, `login/verify|resend` (email OTP when 2FA is on), `refresh`, `logout`, `password/reset/start|verify` (by `email` or `phone`). Owners: the same under `/v1/owner/auth/*` |
| Me | Owners: `/v1/owner/me`, `settings`, `sessions`, `password`, `phone/start|verify`, `avatar` (no `delete`). Players: `/v1/me`, `settings` (notifications, `twoFactor`), `sessions`, `password`, `phone/start|verify`, `delete`, `saved`, `places`, `avatar`, `bookings`, `holds`, `notifications`, `requests`, `push-token` |
| Venues | `/v1/venues/explore`, `/:id`, `/:id/slots` (**live, never cached**), `/:id/reviews`, `/:id/reviews/mine` |
| Booking | `/v1/holds` (hold slots) → `/v1/payments` (bKash) → `/v1/bookings/:id`; `cancel` |
| Squads | `/v1/matches` feed, create, `/:id`, `join`, `pay`, `manage`, accept/decline, `joined`, `mine` |
| Passes | `/v1/passes/verify`, `/v1/passes/check-in` (QR entry pass at the turf) |
| Owner | `/v1/owner/venues` list/get/create/update/delete (+ optional `slots`, `priceBands`); `/v1/owner/venues/:id/day` (day sheet, live), `/:id/blocks`; `/v1/owner/stats`, `/calendar`; `/v1/owner/bookings` list/get, `POST` (walk-in), `/:id/cancel`, `/:id/check-in`; `/v1/owner/blocks` create/delete; `/v1/owner/reviews`; `/v1/owner/tournaments` CRUD + `/:id/teams`; `/v1/owner/notifications`, `/seen` (guard: `requireOwner`, every query scoped to the owner's turfs) |
| Tournaments (public) | `/v1/venues/:id/tournaments` (published, upcoming; for the player app later) |
| Misc | `/health`, `/v1/config` (realtime keys etc.), `/v1/uploads` (R2; returns `publicUrl` too), `/internal/reconcile` (cron secret) |

Validation: every body/param is parsed with zod in `app.ts` (`parse(schema, data)`), e.g. phone
numbers via `phone10` (10 national digits, stored as `+880…`). Errors are `ApiError(code, message)`
with user-readable messages.

---

## 6. Database (tables)

`users · sessions · owners · owner_sessions · otp_codes · venues · venue_photos · venue_schedule · venue_pricing · pitches ·
venue_blocks · bookings · payments · ledger_entries · idempotency_keys · saved_venues · reviews ·
notifications · player_requests · player_request_members · audit_log · user_places · slot_updates ·
orders · match_updates · push_tokens · tournaments · tournament_teams · owner_inbox`

Key facts:
- **Players and owners are separate tables.** `users` (+ `sessions`) are players only; `owners`
  (+ `owner_sessions`) are turf owners. `otp_codes.realm` keeps their codes apart, so one person can
  have a player account and an owner account with the same phone and email. Owner data points at
  `owners`: `venues.owner_id`, `bookings.created_by` (walk-ins), `venue_blocks.created_by`,
  `owner_inbox.user_id`. `bookings.user_id`, reviews, orders etc. stay on `users` (players).
  Migration 022 copied every existing owner to `owners` with the same id, password, email, phone and
  photo, and removed `owner` from `users.roles` (their player accounts stay).
  `venues.status`: draft | pending | published | suspended.
- `bookings.status`: held → pending → confirmed → checked_in → completed (or cancelled/expired).
  Holds expire automatically (pg_cron). An exclusion constraint (`bookings_no_overlap`) makes the database refuse overlapping active bookings on a pitch.
- **Money is a ledger**: `payments` + `ledger_entries` (`charge`, `service_fee`, `owner_payable`,
  `refund`). Rows are appended, never edited. Owner revenue = sum of `owner_payable`.
- `idempotency_keys`: every money-moving POST takes an `Idempotency-Key` header.
- `slot_updates(venue_id, day)` is touched (by triggers) whenever availability changes, including
  squads. The app listens via Supabase Realtime and refetches from the API.
- Squads: `player_requests` (a host's open spots on a booking) + `player_request_members`.
  Phone numbers are shared only with explicit consent (`phone_consent_at`), only after payment,
  only host ⇄ paid player — players never see each other. Each side may share a different number
  for that squad (`contact_phone`).
- Reviews: one per player per venue, only after they played; final (no edit/delete). Venue rating is
  maintained by a trigger.
- `audit_log` exists — use it for every owner/admin change (the owner dashboard writes it for walk-ins,
  cancels, check-ins, closures and tournaments).
- **Sessions & prices** (migration 020): `venue_schedule.slot_mode` = `fixed` (back-to-back sessions of
  `session_min`: 60, 90 or any length) or `custom` (`custom_slots`: the owner's own list, each with an
  optional own price). `venue_pricing.bands` = time-of-day hourly prices (optional weekdays).
  Price of a session: special date → the session's own price → time band → weekday rate → standard rate.
  One implementation (`sessionsFor` + `priceFor` in `server/src/lib/time.ts`) serves slots, holds and the
  owner day sheet, so what players see is what they pay.
- **Walk-ins**: `bookings.source = 'walkin'`, no user, `guest_name/guest_phone/note`, created through the same
  pitch lock + exclusion constraint as app bookings. Closures (`venue_blocks`, now with `kind`, `tournament_id`)
  can't cover live bookings, holds refuse them, and a trigger touches `slot_updates` so apps refresh.

RLS is enabled with no policies on every table: the public Supabase keys can read nothing except
the `slot_updates` realtime feed. The API connects as the DB owner.

---

## 7. Non-negotiable product rules

1. **Slot availability is never cached** — not on the server, not in the app. Always fetched live
   and checked before it's shown; realtime pushes trigger refetches.
2. **No security holes**, especially around payments: server-side validation, idempotency,
   ownership checks on every row, rate limits on auth/money routes, no secrets in apps.
3. **Consistent visuals**: never hard-code colours, radius or font sizes — use `src/theme/tokens.ts`.
   Controls are pill-shaped, cards use `radius.lg`, borders are 1px `colors.border`.
   Lime = primary actions/active states only; orange = brand accent only.
4. **Fast and light**: image compression, debouncing, caching (except slots), small payloads —
   it must run well on shared hosting with 1000+ active users.
5. Phone numbers in squads follow the consent rules in §6.
6. Codes (OTP) go by **email**; SMS only for changing a phone number or accounts without email.
   Sign-in 2FA is per user (`Enable 2FA` switch, off by default).

---

## 8. Never-break rules (how one app's change can't break another)

1. **Never break a released endpoint.** Only *add* fields/routes. A truly breaking change becomes a
   new route or `/v2/...`, and `/v1` keeps working until old app versions are gone. Mobile users
   don't all update.
2. **Migrations are additive** ("expand, then contract"): add the new column/table, ship code that
   uses it, remove old things only much later. New migration = `server/db/migrations/0NN_name.sql`
   **and** registered in `server/src/migrations.ts`. Never edit an applied migration.
3. **Each audience has its own route group and guard**: `/v1/*` players, `/v1/owner/*`
   (`requireOwner` + venue membership check), `/v1/admin/*` (admin role + 2FA + audit). Owner/admin
   features never change what player routes return.
4. **Each business area owns its tables.** Other areas call its service functions, not its SQL.
5. **Tests gate every deploy.** `deploy-server.yml` runs typecheck, build and the full e2e suite
   (70 tests today, including the player app's own API client) against a throwaway Postgres + Redis.
   If anything fails, nothing deploys. Add tests for every new endpoint (owner/admin get their own
   files, like `owner.e2e.test.ts`).
6. **Feature flags** for half-built features; **separate deploys** per app (EAS channels per mobile
   app; Vercel/Cloudflare for web dashboards).
7. Before declaring any app change done: `npx expo lint` and `npx tsc --noEmit` (app), `npm run build`
   + tests (server).

---

## 9. Plan: owner dashboard, owner app, company dashboard

> **Done (Nov 2026):** owner data model (sessions, time-band prices, walk-ins, closures, tournaments, inbox)
> and the `/v1/owner/*` module with tests (`owner-dashboard.e2e.test.ts`), plus the owner web dashboard
> (`turfsidesadmin`, Next.js). It calls only the API, signs in with owner accounts (`/v1/owner/auth/*`), and gets live
> updates the same way as the player app (Supabase Realtime on `slot_updates`, polling as a fallback).
> Its origin must be listed in the API's `CORS_ORIGINS`. Still to do: `venue_members` (staff), the monorepo
> move and shared `packages/*`, owner mobile, company dashboard.

### Target repo layout (monorepo, npm/pnpm workspaces + Turborepo)

```
apps/player/        today's Expo app (moved from the root)
apps/owner-mobile/  Expo
apps/owner-web/     Next.js
apps/admin-web/     Next.js (company only, separate domain e.g. admin.turfsides.com)
server/             the same Fastify API
packages/contracts/ zod schemas + types for every request/response — the server validates with the
                    same schemas the apps compile against, so a breaking change fails CI, not users
packages/api-client typed fetch + TanStack Query hooks (shared by owner web + owner mobile)
packages/domain/    pure logic: Dhaka time, slot generation, pricing, money formatting
packages/tokens/    design tokens shared across all apps
```

The move to a monorepo is housekeeping: URLs and behaviour stay the same.

### Server changes (same server, same database)

- Split `server/src/app.ts` into route modules per audience (player / owner / admin). No URL changes.
- `venue_members(owner_id → owners, venue_id, role: owner | manager | staff)` — keep `venues.owner_id` as is.
  Every owner query is scoped by `venue_id` + membership check.
- Owner features: venue profile & photos, pitches (5A/6A/7A, football/cricket), opening hours,
  pricing rules (day/time/peak/holidays), blocks (closures, maintenance, offline/walk-in bookings),
  facilities (paid/free), arena rules, refund policy, bookings list & calendar, QR check-in,
  revenue & payouts (from the ledger), reviews, staff, notifications.
- Admin role + `/v1/admin/*`: all venues/owners/bookings/payments, approve/suspend listings, refunds,
  KPIs (GMV, commission, active users, top venues). Heavy reports read summary tables, not live
  queries. Every admin action → `audit_log`.
- Owner realtime ("new booking", "checked in"): a per-venue event channel. Long-lived sockets are
  unreliable on cPanel, so use Supabase Realtime / Ably / Pusher (API publishes, apps listen);
  push notifications cover closed apps.
- Hosting: when owners rely on it daily, move the same API from cPanel to a small VPS or
  Railway/Fly/Render. Supabase, R2, Upstash stay.

### Build order

1. Monorepo + extract `contracts`, `domain`, `api-client`, `tokens`.
2. Owner data model (`venue_members`, pricing, blocks…) + `/v1/owner/*` module + tests.
3. **Owner web** (fastest way to settle the features).
4. **Owner mobile**, reusing the same hooks and logic.
5. **Company dashboard** + analytics.

---

## 10. Working on this repo (practical)

- Owner's Mac folder: `/Users/user/Projects/turfsides`.
- App: `npx expo start`. Use `npx expo install <pkg>` for Expo packages.
- API locally: `cd server && npm run dev` (needs Postgres, Redis + `scripts/upstash-local.mjs`).
  Tests: `npm run build && npm test` with the env from `deploy-server.yml`.
- Deploy: push to `main` (GitHub Actions → cPanel). Secrets live only in cPanel env vars and
  GitHub secrets — never in the repo.
- Builds: `eas.json` profiles `development`, `development-simulator`, `preview` (Android APK),
  `production`. `IOS_FREE_SIGNING=1` drops push for free Apple ID device builds.
  Android maps need `GOOGLE_MAPS_ANDROID_API_KEY` as an EAS env var.
