-- Find an opponent: a squad post can ask for a whole other team instead of single players.
-- An opponent post has one "spot" (the other team); its captain asks with the team's name and
-- size and, once accepted, pays the team's share of the turf (set by the host, default half).
alter table player_requests
  add column if not exists type text not null default 'players' check (type in ('players', 'opponent')),
  add column if not exists team_name text,
  add column if not exists opponent_percent int check (opponent_percent between 10 and 90);
alter table player_request_members
  add column if not exists team_name text,
  add column if not exists team_size int check (team_size between 1 and 15);
create index if not exists player_requests_open_type_idx on player_requests (type) where status = 'open';
