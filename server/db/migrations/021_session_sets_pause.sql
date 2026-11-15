-- Owner dashboard, round 2. Additive only: defaults keep today's behaviour for the player app
-- and for API code that doesn't know these columns.

-- 1) Pause bookings: the owner can stop new bookings for a while (rain, repairs, an event).
--    Existing bookings stay. Players see the notice and every session shows as not available.
alter table venues add column if not exists booking_paused boolean not null default false;
alter table venues add column if not exists booking_notice text check (booking_notice is null or length(booking_notice) <= 200);

-- 2) Session sets: named lists of custom sessions (e.g. "Weekday", "Ramadan", "Winter").
--    One set is live; its sessions are copied to custom_slots, which is what booking uses.
--    [{"id": "s1", "name": "Ramadan", "live": true, "slots": [{"start": 420, "end": 510, "price": 150000}]}]
alter table venue_schedule add column if not exists slot_sets jsonb;
