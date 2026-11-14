-- The organiser may share a different number with their squad than the one on their account.
alter table player_requests add column if not exists contact_phone text;
