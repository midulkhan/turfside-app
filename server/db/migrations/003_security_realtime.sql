-- 1) Supabase exposes the public schema through its Data API (PostgREST).
--    Our API connects as the owner role (bypasses RLS); the public anon/authenticated
--    keys must see NOTHING. Enable RLS with no policies on every table = deny all.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  alter table public.schema_migrations enable row level security;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    -- and for anything created later
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated';
  end if;
end $$;

-- 2) Real-time availability. A tiny, non-personal table: one row per venue/day
--    that is touched whenever a booking on that day changes. The app subscribes
--    (Supabase Realtime) and refetches slots from the API instantly.
create table if not exists slot_updates (
  venue_id text not null references venues(id) on delete cascade,
  day date not null,
  updated_at timestamptz not null default now(),
  primary key (venue_id, day)
);
alter table slot_updates enable row level security;

create or replace function touch_slot_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into slot_updates(venue_id, day) values (old.venue_id, old.day)
      on conflict (venue_id, day) do update set updated_at = now();
    return old;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into slot_updates(venue_id, day) values (new.venue_id, new.day)
      on conflict (venue_id, day) do update set updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists bookings_touch_slots on bookings;
create trigger bookings_touch_slots after insert or update of status or delete on bookings
  for each row execute function touch_slot_update();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Read-only, and only this table: venue id, day, timestamp. No personal data.
    execute 'grant select on public.slot_updates to anon, authenticated';
    execute 'drop policy if exists slot_updates_read on public.slot_updates';
    execute 'create policy slot_updates_read on public.slot_updates for select to anon, authenticated using (true)';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'slot_updates') then
    execute 'alter publication supabase_realtime add table public.slot_updates';
  end if;
end $$;
