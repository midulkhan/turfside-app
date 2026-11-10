-- Find players v2: a request can be for several spots (you + friends), and matches are live.

-- 1) How many spots one request is for (1 = just me). The share is per spot.
alter table player_request_members add column if not exists spots int not null default 1;
alter table player_request_members drop constraint if exists player_request_members_spots_check;
alter table player_request_members add constraint player_request_members_spots_check check (spots between 1 and 29);

-- 2) Real-time matches. A tiny, non-personal table touched whenever a match or anyone's
--    request on it changes. The app listens (Supabase Realtime) and refetches from the API.
create table if not exists match_updates (
  match_id uuid primary key references player_requests(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table match_updates enable row level security;

create or replace function touch_match_update() returns trigger language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if tg_table_name = 'player_requests' then
    mid := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    mid := case when tg_op = 'DELETE' then old.request_id else new.request_id end;
  end if;
  -- A request removed along with its match: nothing left to signal.
  if tg_op = 'DELETE' and not exists (select 1 from player_requests where id = mid) then return old; end if;
  insert into match_updates(match_id) values (mid) on conflict (match_id) do update set updated_at = now();
  return coalesce(new, old);
end $$;

drop trigger if exists player_requests_touch_live on player_requests;
create trigger player_requests_touch_live after insert or update on player_requests
  for each row execute function touch_match_update();
drop trigger if exists player_request_members_touch_live on player_request_members;
create trigger player_request_members_touch_live after insert or update or delete on player_request_members
  for each row execute function touch_match_update();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Read-only, and only ids and timestamps: no personal data.
    execute 'grant select on public.match_updates to anon, authenticated';
    execute 'drop policy if exists match_updates_read on public.match_updates';
    execute 'create policy match_updates_read on public.match_updates for select to anon, authenticated using (true)';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'match_updates') then
    execute 'alter publication supabase_realtime add table public.match_updates';
  end if;
end $$;
