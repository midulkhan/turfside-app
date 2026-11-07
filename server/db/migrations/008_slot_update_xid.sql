-- Realtime "this day changed" events now carry the id of the transaction that changed it.
-- The app passes it back when it refetches (?v=<xid>), and the API serves its cached slots
-- only if that cached copy's database snapshot already includes the transaction.
alter table slot_updates add column if not exists xid xid8;

create or replace function touch_slot_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into slot_updates(venue_id, day, xid) values (old.venue_id, old.day, pg_current_xact_id())
      on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid;
    return old;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into slot_updates(venue_id, day, xid) values (new.venue_id, new.day, pg_current_xact_id())
      on conflict (venue_id, day) do update set updated_at = now(), xid = excluded.xid;
  end if;
  return new;
end $$;
