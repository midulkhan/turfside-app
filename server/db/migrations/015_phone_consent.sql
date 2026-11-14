-- Phone numbers in a squad are shared only with explicit agreement, recorded here:
-- the organiser agrees when opening spots, each player when asking to join.
-- Numbers are shown only after the player has paid, and only organiser <-> player.
alter table player_requests add column if not exists phone_consent_at timestamptz;
alter table player_request_members add column if not exists phone_consent_at timestamptz;
