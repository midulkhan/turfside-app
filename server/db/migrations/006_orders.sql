-- Orders: a player's cart. One order = one turf, one or more slots, one payment.
-- A player has at most one open order; starting a new one releases the old one.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  venue_id text not null references venues(id),
  status text not null check (status in ('held', 'pending', 'confirmed', 'expired', 'cancelled')),
  hold_expires_at timestamptz,
  price_lines jsonb not null,                  -- snapshot, as on bookings
  total bigint not null check (total >= 0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
-- The "one cart per player" guarantee, enforced by the database.
create unique index if not exists orders_one_open_per_user on orders(user_id) where status in ('held', 'pending');
create index if not exists orders_hold_idx on orders(hold_expires_at) where status = 'held';
alter table orders enable row level security;

-- Each slot stays its own booking row (own code, own entry pass, own overlap guard).
alter table bookings add column if not exists order_id uuid references orders(id);
create index if not exists bookings_order_idx on bookings(order_id);

alter table payments add column if not exists order_id uuid references orders(id);
create index if not exists payments_order_idx on payments(order_id);

-- Expire orders together with their slots.
create or replace function release_expired_holds() returns int language sql as $$
  with o as (
    update orders set status = 'expired'
    where status = 'held' and hold_expires_at < now()
    returning 1
  ), x as (
    update bookings set status = 'expired'
    where status = 'held' and hold_expires_at < now()
    returning 1
  ) select count(*)::int from x; -- (data-changing CTEs always run, so o runs too)
$$;
