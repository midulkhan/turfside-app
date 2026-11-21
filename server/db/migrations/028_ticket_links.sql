-- Ticket links and walk-in contact details.
--  ticket_token: the secret part of a ticket's shareable link (api.turfsides.com/ticket/<token>):
--    23 random letters and digits (about 137 bits), made by the API the first time the link is
--    needed. Unique, so a token always names one booking.
--  guest_email: the walk-in customer's email (the ticket is emailed there).
alter table bookings add column if not exists ticket_token text
  check (ticket_token is null or ticket_token ~ '^[A-Za-z0-9]{23}$');
create unique index if not exists bookings_ticket_token_key on bookings (ticket_token) where ticket_token is not null;
alter table bookings add column if not exists guest_email text
  check (guest_email is null or length(guest_email) <= 254);
