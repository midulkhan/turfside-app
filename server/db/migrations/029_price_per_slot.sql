-- Prices per slot. Until now a turf's standard, weekday, special-date and time-of-day rates were
-- per hour (a 2-hour session cost twice the rate). price_per = 'slot' makes each of those the
-- price of one session, whatever its length. Existing turfs stay 'hour' (exactly what players pay
-- today) until the owner saves them from the dashboard, which saves per slot.
-- The rate columns keep their names (standard_hourly, weekday_hourly, bands[].hourly): they now
-- hold the rate in the turf's unit.
alter table venue_pricing add column if not exists price_per text not null default 'hour'
  check (price_per in ('hour', 'slot'));
