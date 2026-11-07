-- Account settings + account deletion.
alter table users add column if not exists notify_enabled boolean not null default true;
alter table users add column if not exists deleted_at timestamptz;
-- A deleted account gives its phone number back (so it can sign up again); the row stays,
-- anonymised, because bookings and payments reference it.
alter table users alter column phone drop not null;
-- Device label the app sends (e.g. "iPhone 15 · iOS 18.1"), for "Signed-in devices".
alter table sessions add column if not exists device text;
