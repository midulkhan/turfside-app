-- Share links for player and opponent requests: turfsides.com/K7QM2XP, the same 7-character
-- format as turf links. Turfs and requests share one pool of codes, so a link alone says which
-- one it is: the server and the app look the code up in both.

create or replace function gen_share_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..7 loop
      code := code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from venues where short_code = code)
          and not exists (select 1 from player_requests where short_code = code);
  end loop;
  return code;
end $$;

alter table player_requests add column if not exists short_code text;

-- Turfs now draw from the shared pool too (existing turf codes are unchanged).
create or replace function gen_venue_short_code() returns text language sql volatile as $$ select gen_share_code() $$;

-- Existing requests: one row at a time, so each new code sees the ones given before it.
do $$
declare r record;
begin
  for r in select id from player_requests where short_code is null order by created_at, id loop
    update player_requests set short_code = gen_share_code() where id = r.id;
  end loop;
end $$;

alter table player_requests alter column short_code set default gen_share_code();
alter table player_requests alter column short_code set not null;
do $$ begin
  alter table player_requests add constraint player_requests_short_code_format check (short_code ~ '^[A-HJ-NP-Z2-9]{7}$');
exception when duplicate_object then null; end $$;
create unique index if not exists player_requests_short_code_key on player_requests (short_code);
