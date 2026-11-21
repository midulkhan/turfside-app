-- The Google Maps link the owner pasted for the turf. Players' "Map" / "Directions" open it as is
-- (it points at the exact place); the API also reads coordinates from it when it can.
alter table venues add column if not exists map_url text;
