-- Find players: open spots on a confirmed booking ("match"), join requests, share payments.
-- Builds on the player_requests / player_request_members tables from 001.

-- A match: open spots offered on one confirmed booking.
--   players_total  squad size (e.g. 10 for 5-a-side)
--   spots_total    spots opened to other players (the organiser brings the rest)
--   spots_filled   joiners who have paid
--   share          price per player in poisha (booking total / players_total, rounded up to the taka)
alter table player_requests add column if not exists title text not null default 'Open match';
alter table player_requests add column if not exists level text not null default 'casual';
alter table player_requests add column if not exists format text not null default '5-a-side';
alter table player_requests add column if not exists players_total int not null default 10;
alter table player_requests add column if not exists updated_at timestamptz not null default now();
alter table player_requests drop constraint if exists player_requests_status_check;
alter table player_requests add constraint player_requests_status_check check (status in ('open', 'paused', 'full', 'closed', 'cancelled'));
alter table player_requests drop constraint if exists player_requests_title_check;
alter table player_requests add constraint player_requests_title_check check (length(title) between 2 and 60);
alter table player_requests drop constraint if exists player_requests_level_check;
alter table player_requests add constraint player_requests_level_check check (level in ('casual', 'regular', 'competitive'));
alter table player_requests drop constraint if exists player_requests_players_check;
alter table player_requests add constraint player_requests_players_check check (players_total between 2 and 30 and spots_total < players_total);
-- One live match per booking.
create unique index if not exists player_requests_one_per_booking on player_requests(booking_id) where status <> 'cancelled';
create index if not exists player_requests_status_idx on player_requests(status, created_at);

-- A join request. pending → accepted (spot reserved until pay_by) → paid; or declined / withdrawn / expired.
alter table player_request_members add column if not exists position text;
alter table player_request_members add column if not exists level text;
alter table player_request_members add column if not exists decided_at timestamptz;
alter table player_request_members add column if not exists pay_by timestamptz;
alter table player_request_members add column if not exists paid_at timestamptz;
alter table player_request_members drop constraint if exists player_request_members_status_check;
alter table player_request_members add constraint player_request_members_status_check
  check (status in ('pending', 'accepted', 'declined', 'paid', 'withdrawn', 'expired'));
alter table player_request_members drop constraint if exists player_request_members_position_check;
alter table player_request_members add constraint player_request_members_position_check
  check (position is null or position in ('any', 'goalkeeper', 'defender', 'midfielder', 'forward'));
alter table player_request_members drop constraint if exists player_request_members_level_check;
alter table player_request_members add constraint player_request_members_level_check
  check (level is null or level in ('casual', 'regular', 'competitive'));
create index if not exists player_request_members_user_idx on player_request_members(user_id, created_at desc);

-- A player's share of a match is paid like a booking, through bKash; it never touches the booking.
alter table payments add column if not exists kind text not null default 'booking';
alter table payments drop constraint if exists payments_kind_check;
alter table payments add constraint payments_kind_check check (kind in ('booking', 'share'));
alter table payments add column if not exists match_id uuid references player_requests(id);
alter table player_request_members add column if not exists payment_id uuid references payments(id);

-- Notifications can point at a match (e.g. "accepted: pay your share").
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('booking', 'payment', 'promo', 'match'));
alter table notifications add column if not exists data jsonb;
