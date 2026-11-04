-- Saved locations ("Home", "Work", a friend's place…) per player.
-- Coordinates are stored rounded to ~100 m by the API; that is all the app needs.
create table if not exists user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  name text not null check (char_length(name) between 1 and 80),
  city text not null default '' check (char_length(city) <= 80),
  address text not null default '' check (char_length(address) <= 200),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_places_user on user_places (user_id, created_at);

-- Same lockdown as every other table: invisible to Supabase's public keys.
alter table user_places enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.user_places from anon, authenticated';
  end if;
end $$;
