-- Two-step sign-in is optional, per account, and off by default: with it on, signing in also
-- needs a 6-digit code sent to the account's email.
alter table users add column if not exists two_factor boolean not null default false;
