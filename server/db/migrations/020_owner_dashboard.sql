-- Owner dashboard (web now, owner mobile app later). Additive only: every new column has a
-- default that keeps today's behaviour, so the player app and older API code are unaffected.

-- 1) Flexible sessions. 'fixed' = back-to-back sessions of session_min (60, 90, any length) as
--    before; 'custom' = the owner's own list of sessions, each optionally with its own price:
--    [{"start": 420, "end": 510, "price": 150000}]  (minutes after Dhaka midnight, poisha).
alter table venue_schedule add column if not exists slot_mode text not null default 'fixed';
alter table venue_schedule add column if not exists custom_slots jsonb;
do $$ begin
  alter table venue_schedule add constraint venue_schedule_slot_mode_chk check (slot_mode in ('fixed', 'custom'));
exception when duplicate_object then null; end $$;

-- 2) Time-of-day prices: [{"from": 420, "to": 600, "hourly": 150000, "days": [5, 6]}]
--    (sessions starting 07:00–10:00 cost ৳1,500/hour; days optional, 0 = Sunday).
alter table venue_pricing add column if not exists bands jsonb not null default '[]';

-- 3) Walk-in / phone bookings the owner takes himself (source = 'walkin', no app user).
alter table bookings add column if not exists guest_name text check (guest_name is null or length(guest_name) <= 80);
alter table bookings add column if not exists guest_phone text check (guest_phone is null or length(guest_phone) <= 20);
alter table bookings add column if not exists note text check (note is null or length(note) <= 300);
alter table bookings add column if not exists created_by uuid references users(id) on delete set null;
alter table bookings add column if not exists checked_in_at timestamptz;
create index if not exists bookings_venue_created_idx on bookings(venue_id, created_at desc);

-- 4) Closures: what kind, who, and (for tournaments) which tournament.
alter table venue_blocks add column if not exists kind text not null default 'closed';
alter table venue_blocks add column if not exists created_by uuid references users(id) on delete set null;
alter table venue_blocks add column if not exists created_at timestamptz not null default now();

-- 5) Tournaments hosted at a turf.
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references venues(id) on delete cascade,
  title text not null check (length(title) between 3 and 100),
  sport text not null default 'football' check (sport in ('football', 'cricket')),
  format text not null default '5-a-side',
  description text not null default '' check (length(description) <= 3000),
  terms text not null default '' check (length(terms) <= 5000),
  prizes text not null default '' check (length(prizes) <= 1000),
  entry_fee bigint not null default 0 check (entry_fee >= 0),
  max_teams int not null default 8 check (max_teams between 2 and 128),
  team_size int not null default 7 check (team_size between 1 and 30),
  starts_on date not null,
  ends_on date not null,
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min > start_min and end_min <= 2880),
  registration_closes date,
  contact_phone text,
  cover_url text,
  block_turf boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists tournaments_venue_idx on tournaments(venue_id, starts_on desc);
alter table tournaments enable row level security;

create table if not exists tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  captain_name text not null check (length(captain_name) between 2 and 80),
  captain_phone text not null check (length(captain_phone) <= 20),
  players int not null default 0 check (players between 0 and 40),
  paid boolean not null default false,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists tournament_teams_idx on tournament_teams(tournament_id, created_at);
alter table tournament_teams enable row level security;

alter table venue_blocks add column if not exists tournament_id uuid references tournaments(id) on delete cascade;

-- 6) Owner inbox: when the owner last opened his notifications (the feed itself is built
--    from bookings, cancellations, reviews and tournament entries).
create table if not exists owner_inbox (
  user_id uuid primary key references users(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table owner_inbox enable row level security;

-- 7) A closure changes availability too: tell apps watching those days (realtime), as bookings do.
create or replace function touch_block_slots() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; vid text; d date;
begin
  for r in select * from (select new.pitch_id p, new.during w where tg_op <> 'DELETE'
                          union all select old.pitch_id, old.during where tg_op <> 'INSERT') x loop
    select venue_id into vid from pitches where id = r.p;
    if vid is null then continue; end if;
    -- from the day before (sessions after midnight belong to the previous venue day)
    d := (lower(r.w) at time zone 'Asia/Dhaka')::date - 1;
    while d <= (upper(r.w) at time zone 'Asia/Dhaka')::date loop
      insert into slot_updates(venue_id, day, xid) values (vid, d, pg_current_xact_id())
        on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid;
      d := d + 1;
    end loop;
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists venue_blocks_touch_slots on venue_blocks;
create trigger venue_blocks_touch_slots after insert or update or delete on venue_blocks
  for each row execute function touch_block_slots();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.tournaments, public.tournament_teams, public.owner_inbox from anon, authenticated';
  end if;
end $$;
