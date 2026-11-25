-- Partial payment at checkout: pay 500 tk per slot in the app, the rest at the turf.
--
--   bookings.pay_mode     'full' (default, every booking before this) or 'partial'
--   bookings.paid_online  what the player paid through TurfSides for this slot (poisha).
--                         Null = the whole total (full payments, older bookings). Walk-ins
--                         never go through TurfSides, so for them it stays null and unused.
--   due at the turf       = total - coalesce(paid_online, total)
--
-- Commission is always on the full price (bookings.total), however the player pays: the
-- earnings trigger is unchanged for gross / commission / net. owner_earnings.collected is new:
-- the money TurfSides actually received for the booking (500 tk on a partial one), so a payout
-- can later pay the owner collected − commission instead of assuming the whole price came in.

alter table bookings add column if not exists pay_mode text not null default 'full';
do $$ begin
  alter table bookings add constraint bookings_pay_mode_check check (pay_mode in ('full', 'partial'));
exception when duplicate_object then null; end $$;
alter table bookings add column if not exists paid_online bigint;
do $$ begin
  alter table bookings add constraint bookings_paid_online_check check (paid_online is null or (paid_online >= 0 and paid_online <= total));
exception when duplicate_object then null; end $$;

alter table owner_earnings add column if not exists collected bigint;
update owner_earnings e set collected = case when e.kind = 'sale' then b.total else -b.total end
  from bookings b where b.id = e.booking_id and e.collected is null;

create or replace function owner_earnings_track() returns trigger
language plpgsql as $$
declare
  v_owner uuid;
  v_rate int;
  v_comm bigint;
  s owner_earnings%rowtype;
begin
  if new.source = 'walkin' then return new; end if;
  if new.status in ('confirmed', 'checked_in', 'completed')
     and (tg_op = 'INSERT' or old.status not in ('confirmed', 'checked_in', 'completed')) then
    select owner_id into v_owner from venues where id = new.venue_id;
    if v_owner is null then return new; end if;
    v_rate := commission_bp(v_owner, now());
    v_comm := (new.total * v_rate + 5000) / 10000; -- on the full price, half up
    insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp, collected)
      values (v_owner, new.venue_id, new.id, 'sale', new.total, v_comm, new.total - v_comm, v_rate, coalesce(new.paid_online, new.total))
      on conflict (booking_id, kind) do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    select * into s from owner_earnings where booking_id = new.id and kind = 'sale';
    if found then
      insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp, collected)
        values (s.owner_id, s.venue_id, s.booking_id, 'reversal', -s.gross, -s.commission, -s.net, s.rate_bp, -coalesce(s.collected, s.gross))
        on conflict (booking_id, kind) do nothing;
    end if;
  end if;
  return new;
end $$;

-- Players can now cancel up to 6 hours before kick-off (was 24). Turfs still showing the old
-- default text get the new one; a turf's own wording is left alone.
alter table venues alter column cancellation_policy set default 'Free cancellation up to 6 hours before kick-off.';
update venues set cancellation_policy = 'Free cancellation up to 6 hours before kick-off.'
 where cancellation_policy = 'Free cancellation up to 24 hours before kick-off.';

-- Squads and opponents no longer pay in the app: the host accepting a request confirms it, and
-- the player pays their share to the host at the turf. Requests accepted before this and still
-- inside their pay window are confirmed now ('paid' is the confirmed-member status).
update player_request_members m set status = 'paid', paid_at = now(), pay_by = null
  from player_requests r join bookings b on b.id = r.booking_id
 where m.request_id = r.id and m.status = 'accepted' and m.pay_by > now()
   and r.status <> 'cancelled' and b.day >= (now() at time zone 'Asia/Dhaka')::date;
update player_requests r set spots_filled = x.n,
       status = case when x.n >= r.spots_total and r.status = 'open' then 'full' else r.status end
  from (select request_id, coalesce(sum(spots), 0)::int n from player_request_members where status = 'paid' group by request_id) x
 where x.request_id = r.id and r.spots_filled <> x.n;
