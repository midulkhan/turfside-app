# TurfSides API

Fastify + PostgreSQL (Supabase) + optional Upstash Redis + bKash Tokenized Checkout.
Built into **one file** (`dist/index.js`) so shared hosting needs no `npm install`.

## Deploy (automatic)
Every push to `main` that touches `server/` runs `.github/workflows/deploy-server.yml`:
typecheck → build → end-to-end tests on a throwaway Postgres → FTPS upload to
`~/api.turfsides.com` → `tmp/restart.txt` restarts the app. A failing test blocks the deploy.

## First-time cPanel setup
1. cPanel → **Setup Node.js App → Create Application**
   - Node.js version: 20 (or newer) · Application mode: Production
   - Application root: `api.turfsides.com` · Application URL: `api.turfsides.com`
   - Application startup file: `dist/index.js`
2. Add the environment variables from `.env.example` (values are never in Git).
3. Start / Restart the app, then open `https://api.turfsides.com/health`.
   On first start the API creates all tables, seeds demo venues and schedules its jobs.

## Endpoints (v1)
| | |
|---|---|
| `GET /health` | DB / cache / payments status and missing config |
| `POST /v1/auth/signup/start` · `/signup/verify` | SMS code sign-up |
| `POST /v1/auth/login` · `/refresh` · `/logout` | Sessions (15-min JWT + rotating refresh token) |
| `POST /v1/auth/password/reset/start` · `/verify` | Password reset by SMS |
| `GET /v1/venues/explore?lat&lng&day&format&floodlit&q` | Nearby turfs, adaptive radius 5→30 km |
| `GET /v1/venues/:id` · `/slots?day=` · `/reviews` | Detail, live availability, reviews |
| `GET/PUT/DELETE /v1/me/saved/:venueId` | Favourites |
| `GET /v1/me` · `/me/bookings` · `/me/notifications` · `/me/requests` | Account data |
| `POST /v1/holds` (Idempotency-Key) · `GET /v1/holds/:id` | 10-minute slot hold, server-priced |
| `POST /v1/payments` (Idempotency-Key) · `GET /v1/payments/:id` | bKash checkout + status |
| `GET /v1/payments/bkash/callback` | bKash redirect → server-side execute & verify |
| `GET /v1/bookings/:id` · `POST /v1/bookings/:id/cancel` | Ticket with signed QR pass |
| `POST /v1/passes/check-in` | Owner scans a pass |
| `POST /internal/reconcile` | Called every minute by Supabase pg_cron |

## Guarantees
- **No double bookings**: Postgres exclusion constraint on `(pitch, time range)`.
- **No unverified payments**: a booking confirms only after `execute`/`query` with bKash
  returns `Completed` with the exact amount and invoice. Late payments for a taken slot
  are flagged `refund_required`, never double-booked.
- **Idempotent** holds and payments; append-only money ledger; integer poisha everywhere.
- Passwords: scrypt. OTPs: HMAC-hashed, 5-minute expiry, 5 attempts, resend cool-down,
  per-phone/IP limits. Refresh tokens: hashed, rotated, reuse revokes the session family.
- Supabase Data API sees nothing: RLS on every table (only `slot_updates` is public).

## Local development
```bash
cp .env.example .env   # set DATABASE_URL to a local Postgres, NODE_ENV=development, BKASH_MODE=simulate
npm install && npm run dev
API_URL=http://localhost:3000 npm test
```
