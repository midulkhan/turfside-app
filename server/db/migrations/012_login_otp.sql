-- Signing in needs an emailed code after the password (two-step sign-in).
alter table otp_codes drop constraint if exists otp_codes_purpose_check;
alter table otp_codes add constraint otp_codes_purpose_check check (purpose in ('signup', 'reset', 'phone_change', 'login'));
