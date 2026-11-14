-- Reviews come only from players who booked and played, one per player per turf (editable).
-- A turf's rating and review count are always computed from these rows: the seeded
-- placeholder figures are replaced by the real ones (no reviews yet = no rating shown).
-- A squad's players share the organiser's booking, so a booking no longer limits reviews.
alter table reviews drop constraint if exists reviews_booking_id_key;
create unique index if not exists reviews_venue_user_uq on reviews(venue_id, user_id) where user_id is not null;
alter table reviews add column if not exists updated_at timestamptz not null default now();

create or replace function refresh_venue_rating() returns trigger language plpgsql security definer set search_path = public as $$
declare vid text := coalesce(new.venue_id, old.venue_id);
begin
  update venues v set
    rating = coalesce((select round(avg(r.rating)::numeric, 1) from reviews r where r.venue_id = vid), 0),
    review_count = (select count(*) from reviews r where r.venue_id = vid)
  where v.id = vid;
  return coalesce(new, old);
end $$;
drop trigger if exists reviews_refresh_rating on reviews;
create trigger reviews_refresh_rating after insert or update or delete on reviews
  for each row execute function refresh_venue_rating();

update venues v set
  rating = coalesce((select round(avg(r.rating)::numeric, 1) from reviews r where r.venue_id = v.id), 0),
  review_count = (select count(*) from reviews r where r.venue_id = v.id);
