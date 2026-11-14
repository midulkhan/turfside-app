-- A squad opening, pausing, filling up or a player paying changes what a booked slot shows
-- on the turf page ("Open spots · 2"). Signal that turf's day so watching apps reload it.
create or replace function touch_squad_slot() returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if tg_table_name = 'player_requests' then
    rid := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    rid := case when tg_op = 'DELETE' then old.request_id else new.request_id end;
  end if;
  insert into slot_updates(venue_id, day, xid)
    select b.venue_id, b.day, pg_current_xact_id()
      from player_requests r join bookings b on b.id = r.booking_id where r.id = rid
    on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid;
  return coalesce(new, old);
end $$;

drop trigger if exists player_requests_touch_slots on player_requests;
create trigger player_requests_touch_slots after insert or update of status, spots_total on player_requests
  for each row execute function touch_squad_slot();
drop trigger if exists player_request_members_touch_slots on player_request_members;
create trigger player_request_members_touch_slots after insert or update of status, spots or delete on player_request_members
  for each row execute function touch_squad_slot();
