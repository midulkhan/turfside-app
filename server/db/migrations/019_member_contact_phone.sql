-- A player may share a different number with the organiser than the one on their account.
alter table player_request_members add column if not exists contact_phone text;
