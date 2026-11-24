-- Where a turf's coordinates came from. 'link' = read from its saved Google Maps link (exact pin).
-- null = not (yet): the API keeps retrying the link in the background until it reads a point.
alter table venues add column if not exists location_source text
  check (location_source is null or location_source in ('link', 'manual'));
