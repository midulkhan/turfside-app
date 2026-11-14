-- Push notifications. One row per device (Expo push token), tied to the login session that
-- registered it, so logging out (or deleting the account) stops pushes to that phone.
create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens(user_id);

-- Every notification row is also sent as a push, once ("outbox"). Rows from before this
-- migration count as already handled, so nobody gets a burst of old news.
alter table notifications add column if not exists pushed_at timestamptz;
update notifications set pushed_at = created_at where pushed_at is null;
create index if not exists notifications_unpushed_idx on notifications(created_at) where pushed_at is null;
