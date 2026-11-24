-- Turf owner earnings and payouts.
--
-- Players pay TurfSides through bKash; TurfSides pays each turf owner later (every night at
-- midnight), keeping a commission. All money is integer poisha (1 taka = 100 poisha), never
-- floating point.
--
--  commission_rates  the commission, in basis points (1 bp = 0.01%; 215 = 2.15%). Global rows have
--                    no owner; an owner-specific row beats the global one. The latest row that has
--                    started applies, and each earning keeps the rate it was charged at, so changing
--                    the rate never changes past money.
--  owner_earnings    one 'sale' row when an app booking is confirmed (paid), and one 'reversal' row
--                    (the same amounts, negative) if that booking is later cancelled and refunded.
--                    Written by a trigger on bookings, so no code path can forget one. Walk-ins are
--                    not here: that money never passes through TurfSides.
--                    net = gross − commission. commission = round(gross × rate_bp / 10000), half up.
--  payouts           a settlement: the owner's unpaid earnings recorded before `cutoff`, summed and
--                    marked paid together (payout_id). Pending = earnings with no payout yet. A
--                    reversal after a booking was paid out is simply a negative pending line,
--                    deducted from the next payout. Voiding a payout puts its earnings back to pending.

create table if not exists commission_rates (
  id bigserial primary key,
  owner_id uuid references owners(id),
  rate_bp int not null check (rate_bp between 0 and 10000),
  effective_from timestamptz not null default now(),
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists commission_rates_lookup on commission_rates(owner_id, effective_from desc);
insert into commission_rates (owner_id, rate_bp, effective_from, note, created_by)
  select null, 215, '2000-01-01T00:00:00Z', 'Launch rate: 2.15% of the booking price', 'migration'
  where not exists (select 1 from commission_rates);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id),
  -- Covers the owner's earnings recorded before this instant (normally a Dhaka midnight).
  cutoff timestamptz not null,
  gross bigint not null,
  commission bigint not null,
  amount bigint not null check (amount > 0),
  entries int not null check (entries > 0),
  status text not null default 'paid' check (status in ('paid', 'void')),
  method text not null default 'bkash' check (length(method) <= 40),
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 500),
  paid_at timestamptz not null default now(),
  created_by text not null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  check (amount = gross - commission)
);
-- One paid settlement per owner per cutoff: a retried or doubled midnight run can't pay twice.
create unique index if not exists payouts_owner_cutoff on payouts(owner_id, cutoff) where status = 'paid';
create index if not exists payouts_owner_idx on payouts(owner_id, paid_at desc);
create index if not exists payouts_paid_at_idx on payouts(paid_at desc);

create table if not exists owner_earnings (
  id bigserial primary key,
  owner_id uuid not null references owners(id),
  venue_id text not null references venues(id),
  booking_id uuid not null references bookings(id),
  kind text not null check (kind in ('sale', 'reversal')),
  gross bigint not null,
  commission bigint not null,
  net bigint not null,
  rate_bp int not null check (rate_bp between 0 and 10000),
  occurred_at timestamptz not null default now(),
  payout_id uuid references payouts(id),
  check (net = gross - commission),
  check ((kind = 'sale' and gross >= 0 and commission >= 0) or (kind = 'reversal' and gross <= 0 and commission <= 0))
);
-- At most one sale and one reversal per booking.
create unique index if not exists owner_earnings_once on owner_earnings(booking_id, kind);
create index if not exists owner_earnings_pending on owner_earnings(owner_id, occurred_at) where payout_id is null;
create index if not exists owner_earnings_owner_time on owner_earnings(owner_id, occurred_at desc);
create index if not exists owner_earnings_payout on owner_earnings(payout_id) where payout_id is not null;
alter table owner_earnings enable row level security;
alter table payouts enable row level security;
alter table commission_rates enable row level security;

-- The rate (bp) that applies to an owner at an instant.
create or replace function commission_bp(p_owner uuid, p_at timestamptz) returns int language sql stable as $$
  select coalesce((
    select rate_bp from commission_rates
     where (owner_id = p_owner or owner_id is null) and effective_from <= p_at
     order by (owner_id is not null) desc, effective_from desc, id desc
     limit 1), 0)
$$;

-- Records a sale when an app booking is first confirmed, and its reversal when it's cancelled.
create or replace function owner_earnings_track() returns trigger language plpgsql as $$
declare
  v_owner uuid;
  v_rate int;
  v_comm bigint;
  s owner_earnings%rowtype;
begin
  if new.source = 'walkin' then return new; end if;
  if new.status in ('confirmed', 'checked_in', 'completed')
     and (tg_op = 'INSERT' or old.status not in ('confirmed', 'checked_in', 'completed')) then
    select owner_id into v_owner from venues where id = new.venue_id;
    if v_owner is null then return new; end if;
    v_rate := commission_bp(v_owner, now());
    v_comm := (new.total * v_rate + 5000) / 10000; -- half up; total and rate are never negative
    insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp)
      values (v_owner, new.venue_id, new.id, 'sale', new.total, v_comm, new.total - v_comm, v_rate)
      on conflict (booking_id, kind) do nothing;
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    select * into s from owner_earnings where booking_id = new.id and kind = 'sale';
    if found then
      insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp)
        values (s.owner_id, s.venue_id, s.booking_id, 'reversal', -s.gross, -s.commission, -s.net, s.rate_bp)
        on conflict (booking_id, kind) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists owner_earnings_track on bookings;
create trigger owner_earnings_track after insert or update of status on bookings
  for each row execute function owner_earnings_track();

-- Bookings paid before this ran: their sales (at the time they were confirmed) and reversals.
-- Nothing has been paid out yet, so all of it starts as pending.
insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp, occurred_at)
  select v.owner_id, b.venue_id, b.id, 'sale', b.total, c.comm, b.total - c.comm, c.bp, b.confirmed_at
    from bookings b
    join venues v on v.id = b.venue_id
    cross join lateral (select commission_bp(v.owner_id, b.confirmed_at) bp) r
    cross join lateral (select r.bp, (b.total * r.bp + 5000) / 10000 comm) c
   where b.source <> 'walkin' and v.owner_id is not null and b.confirmed_at is not null
     and b.status in ('confirmed', 'checked_in', 'completed', 'cancelled')
  on conflict (booking_id, kind) do nothing;
insert into owner_earnings (owner_id, venue_id, booking_id, kind, gross, commission, net, rate_bp, occurred_at)
  select e.owner_id, e.venue_id, e.booking_id, 'reversal', -e.gross, -e.commission, -e.net, e.rate_bp, coalesce(b.cancelled_at, now())
    from owner_earnings e join bookings b on b.id = e.booking_id
   where e.kind = 'sale' and b.status = 'cancelled'
  on conflict (booking_id, kind) do nothing;
