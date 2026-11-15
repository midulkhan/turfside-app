-- Turf owners get their own accounts, separate from players.
--
-- Before: one `users` table; owners were users with 'owner' in `roles`.
-- After:  `owners` (+ `owner_sessions`) for the owner dashboard; `users` is players only.
--
-- Existing owner accounts are copied with the SAME id, password, email and phone, so their turfs,
-- walk-ins, closures and inbox stay linked and they sign in to the dashboard exactly as before.
-- Their `users` row stays as a plain player account (owners signed up as players too; it may hold
-- bookings, reviews or games). Nothing is deleted. Owner dashboard sessions are not carried over:
-- owners sign in once more after this runs.

create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  phone text unique check (phone is null or phone ~ '^1[3-9][0-9]{8}$'),
  email text unique check (email is null or length(email) <= 254),
  password_hash text not null,
  avatar_key text,
  notify_enabled boolean not null default true,
  two_factor boolean not null default false,
  phone_verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists owner_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references owners(id) on delete cascade,
  refresh_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text,
  ip inet,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists owner_sessions_user_idx on owner_sessions(user_id);

-- Codes (sign-up, sign-in, reset) are kept per kind of account: the same phone can have both.
alter table otp_codes add column if not exists realm text not null default 'player';
alter table otp_codes drop constraint if exists otp_codes_realm_check;
alter table otp_codes add constraint otp_codes_realm_check check (realm in ('player', 'owner'));

-- Copy every account that acts as an owner: marked owner, or already linked from owner data
-- (so the foreign keys below can always be created, whatever the live data looks like).
insert into owners (id, name, phone, email, password_hash, avatar_key, notify_enabled, two_factor, phone_verified_at, deleted_at, created_at, updated_at)
select u.id, u.name, u.phone, u.email, u.password_hash, u.avatar_key, u.notify_enabled, u.two_factor, u.phone_verified_at, u.deleted_at, u.created_at, u.updated_at
  from users u
 where 'owner' = any(u.roles)
    or u.id in (select owner_id from venues where owner_id is not null)
    or u.id in (select created_by from bookings where created_by is not null)
    or u.id in (select created_by from venue_blocks where created_by is not null)
    or u.id in (select user_id from owner_inbox)
on conflict (id) do nothing;

-- Owner data now points at owners.
alter table venues drop constraint if exists venues_owner_id_fkey;
alter table venues add constraint venues_owner_id_fkey foreign key (owner_id) references owners(id) on delete set null;
alter table bookings drop constraint if exists bookings_created_by_fkey;
alter table bookings add constraint bookings_created_by_fkey foreign key (created_by) references owners(id) on delete set null;
alter table venue_blocks drop constraint if exists venue_blocks_created_by_fkey;
alter table venue_blocks add constraint venue_blocks_created_by_fkey foreign key (created_by) references owners(id) on delete set null;
alter table owner_inbox drop constraint if exists owner_inbox_user_id_fkey;
alter table owner_inbox add constraint owner_inbox_user_id_fkey foreign key (user_id) references owners(id) on delete cascade;

-- `users` is players only from here on.
update users set roles = array_remove(roles, 'owner') where 'owner' = any(roles);

-- Same lock-down as every other table: only the API (service role) reads these.
alter table owners enable row level security;
alter table owner_sessions enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.owners, public.owner_sessions from anon, authenticated';
  end if;
end $$;
