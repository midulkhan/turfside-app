-- TurfSides schema v1
-- Money is always BIGINT poisha (1 taka = 100 poisha). Times are timestamptz;
-- a venue "day" is a DATE in Asia/Dhaka and a session start is minutes after its midnight.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ── Users & auth ────────────────────────────────────────────────────────────
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  phone text not null unique check (phone ~ '^1[3-9][0-9]{8}$'),  -- 10 national digits
  email text unique check (email is null or length(email) <= 254),
  password_hash text not null,
  roles text[] not null default '{player}',
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_hash text not null unique,           -- sha256 of the opaque refresh token
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text,
  ip inet,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null check (purpose in ('signup', 'reset')),
  code_hash text not null,                     -- HMAC(OTP_SECRET, code), never the code
  payload jsonb,                               -- pending sign-up data (password already hashed)
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_phone_idx on otp_codes(phone, purpose, created_at desc);

-- ── Venues ──────────────────────────────────────────────────────────────────
create table venues (
  id text primary key default ('v_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  owner_id uuid references users(id) on delete set null,
  name text not null,
  area text not null,
  city text not null default 'Dhaka',
  address text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  formats text[] not null default '{5-a-side}',
  floodlit boolean not null default false,
  amenities text[] not null default '{}',
  rules text[] not null default '{}',
  about text not null default '',
  cancellation_policy text not null default 'Free cancellation up to 24 hours before kick-off.',
  rating numeric(2,1) not null default 0,
  review_count int not null default 0,
  status text not null default 'published' check (status in ('draft', 'pending', 'published', 'suspended')),
  created_at timestamptz not null default now()
);
create index venues_geo_idx on venues(lat, lng) where status = 'published';

create table venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references venues(id) on delete cascade,
  url text not null,
  position int not null default 0
);
create index venue_photos_idx on venue_photos(venue_id, position);

create table venue_schedule (
  venue_id text primary key references venues(id) on delete cascade,
  open_min int not null check (open_min between 0 and 1439),
  close_min int not null check (close_min > open_min and close_min <= 2880), -- may run past midnight
  session_min int not null check (session_min between 15 and 360),
  break_min int not null default 0 check (break_min between 0 and 120)
);

create table venue_pricing (
  venue_id text primary key references venues(id) on delete cascade,
  standard_hourly bigint not null check (standard_hourly > 0),
  weekday_hourly jsonb not null default '{}',  -- {"5": 450000, "6": 450000}  (0 = Sunday)
  special_dates jsonb not null default '{}'    -- {"2026-12-16": 500000}
);

create table pitches (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references venues(id) on delete cascade,
  name text not null default 'Main pitch'
);
create index pitches_venue_idx on pitches(venue_id);

create table venue_blocks (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  during tstzrange not null,
  reason text
);
create index venue_blocks_idx on venue_blocks using gist (pitch_id, during);

-- ── Bookings ────────────────────────────────────────────────────────────────
create table bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid references users(id) on delete set null,
  venue_id text not null references venues(id),
  pitch_id uuid not null references pitches(id),
  day date not null,
  start_min int not null,
  end_min int not null check (end_min > start_min),
  during tstzrange not null,
  status text not null check (status in ('held', 'pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'expired')),
  source text not null default 'app' check (source in ('app', 'link', 'walkin')),
  hold_expires_at timestamptz,
  price_lines jsonb not null,                  -- snapshot: later price changes never reprice this booking
  total bigint not null check (total >= 0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  -- THE double-booking guard: the database refuses overlapping active bookings on a pitch.
  constraint bookings_no_overlap exclude using gist (pitch_id with =, during with &&)
    where (status in ('held', 'pending', 'confirmed', 'checked_in'))
);
create index bookings_venue_day_idx on bookings(venue_id, day);
create index bookings_user_idx on bookings(user_id, day desc);
create index bookings_hold_idx on bookings(hold_expires_at) where status = 'held';

-- ── Payments & ledger ───────────────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  user_id uuid references users(id),
  provider text not null default 'bkash',
  amount bigint not null check (amount > 0),
  status text not null check (status in ('initiated', 'pending', 'completed', 'failed', 'cancelled', 'refund_required', 'refunded')),
  idempotency_key text not null unique,
  invoice text not null unique,
  provider_payment_id text unique,
  trx_id text unique,
  last_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_status_idx on payments(status, created_at);

-- Append-only money record. Updates and deletes are rejected by trigger.
create table ledger_entries (
  id bigserial primary key,
  payment_id uuid references payments(id),
  booking_id uuid references bookings(id),
  kind text not null check (kind in ('charge', 'service_fee', 'owner_payable', 'refund')),
  amount bigint not null,
  note text,
  created_at timestamptz not null default now()
);
create or replace function ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'ledger_entries is append-only'; end $$;
create trigger ledger_no_update before update or delete on ledger_entries for each row execute function ledger_immutable();

create table idempotency_keys (
  key text primary key,
  user_id uuid,
  route text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- ── Player features ─────────────────────────────────────────────────────────
create table saved_venues (
  user_id uuid not null references users(id) on delete cascade,
  venue_id text not null references venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references venues(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  booking_id uuid unique references bookings(id),  -- one review per completed booking
  author_name text not null,
  rating int not null check (rating between 1 and 5),
  body text not null default '' check (length(body) <= 1000),
  created_at timestamptz not null default now()
);
create index reviews_venue_idx on reviews(venue_id, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('booking', 'payment', 'promo')),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table player_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  spots_total int not null check (spots_total between 1 and 20),
  spots_filled int not null default 0,
  share bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'full', 'closed')),
  created_at timestamptz not null default now()
);

create table player_request_members (
  request_id uuid not null references player_requests(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb,
  at timestamptz not null default now()
);

-- ── Jobs (safe to call from pg_cron or the API's /internal endpoints) ───────
create or replace function release_expired_holds() returns int language sql as $$
  with x as (
    update bookings set status = 'expired'
    where status = 'held' and hold_expires_at < now()
    returning 1
  ) select count(*)::int from x;
$$;
